#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, Env, String, Vec,
};

const ENVELOPE_COUNT: u32 = 3;
const PERCENT_TOTAL: u32 = 100;
const MAX_MEMBERS: u32 = 2;
const SECONDS_PER_DAY: u64 = 86_400;

// ─── Domain types ─────────────────────────────────────────────────────────

/// Variant order is wire contract: the `balances` Vec<i128> and the `percents`
/// Vec<u32> are indexed [Groceries, Tuition, Savings]. Reordering or inserting
/// would silently break every dashboard reading deployed contracts.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Envelope {
    Groceries,
    Tuition,
    Savings,
}

impl Envelope {
    /// The wire-order index used everywhere balances/percents are accessed.
    fn index(self) -> u32 {
        match self {
            Envelope::Groceries => 0,
            Envelope::Tuition => 1,
            Envelope::Savings => 2,
        }
    }
}

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Percents,
    Members,
    Balances,
    Policy,
    NextRequestId,
    ActiveRequestIds,
    Request(u64),
    /// (caller, day_epoch) → cumulative spent that day. Day epoch is
    /// `ledger.timestamp() / SECONDS_PER_DAY`, so each new UTC day starts a
    /// fresh counter without explicit reset.
    DailySpent(Address, u64),
}

/// All three checks compose with OR — any one triggering routes the spend
/// to admin approval. Default (no policy set) leaves all spends open.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SpendPolicy {
    /// When true, every spend needs admin approval regardless of amount.
    pub require_all_sigs: bool,
    /// Cap on cumulative daily spend per caller (in stroops). None = no cap.
    pub daily_limit: Option<i128>,
    /// Envelopes a member can't spend from directly — admin must approve.
    pub protected_envelopes: Vec<Envelope>,
}

/// Created by `spend` when policy triggers; resolved by `approve_request`
/// (executes the transfer) or `deny_request` (drops it).
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingRequest {
    pub id: u64,
    pub caller: Address,
    pub envelope: Envelope,
    pub amount: i128,
    pub memo: String,
    pub requested_at_ledger: u32,
}

/// Composite view returned to the frontend in one call.
#[contracttype]
#[derive(Clone)]
pub struct WalletState {
    pub admin: Address,
    pub payment_token: Address,
    pub percents: Vec<u32>,
    pub members: Vec<Address>,
    pub balances: Vec<i128>,
    pub policy: SpendPolicy,
    pub pending: Vec<PendingRequest>,
}

/// Emitted by `deposit`. Topic list: ("Deposit", from). Data map:
/// {amount, groceries, tuition, savings}. The frontend filters on the
/// "Deposit" topic to drive the live transaction feed.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Deposit {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub groceries: i128,
    pub tuition: i128,
    pub savings: i128,
}

/// Emitted by `spend` when the policy doesn't block, AND by `approve_request`
/// after a blocked spend is approved. The dashboard treats both the same way.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Spend {
    #[topic]
    pub caller: Address,
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
    pub memo: String,
}

/// Emitted when `spend` is policy-blocked and queued for admin approval
/// instead of executing. Lifecycle: RequestCreated → RequestApproved | RequestDenied.
#[contractevent]
#[derive(Clone, Debug)]
pub struct RequestCreated {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub caller: Address,
    pub envelope: Envelope,
    pub amount: i128,
    pub memo: String,
}

/// Emitted when admin approves a pending request. The transfer that follows
/// also emits a Spend event, so this is purely a correlation signal.
#[contractevent]
#[derive(Clone, Debug)]
pub struct RequestApproved {
    #[topic]
    pub request_id: u64,
}

/// Emitted when admin denies a pending request. No transfer happens.
#[contractevent]
#[derive(Clone, Debug)]
pub struct RequestDenied {
    #[topic]
    pub request_id: u64,
}

/// Explicit discriminants pin the wire format. Frontends match on these
/// numeric codes — do not renumber or reorder.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidPercents = 3,
    DuplicateMember = 4,
    MemberLimitReached = 5,
    InvalidAmount = 6,
    NotAMember = 7,
    InsufficientBalance = 8,
    RequestNotFound = 9,
}

// ─── Private helpers ──────────────────────────────────────────────────────

fn validate_percents(env: &Env, percents: &Vec<u32>) {
    if percents.len() != ENVELOPE_COUNT {
        panic_with_error!(env, Error::InvalidPercents);
    }
    let sum: u32 = percents.iter().sum();
    if sum != PERCENT_TOTAL {
        panic_with_error!(env, Error::InvalidPercents);
    }
}

/// Panics `NotInitialized` if init hasn't run — caller might otherwise expect
/// the generic `require_auth` failure instead.
fn require_admin_auth(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    admin.require_auth();
}

fn require_member(env: &Env, addr: &Address) {
    let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();
    if !members.contains(addr) {
        panic_with_error!(env, Error::NotAMember);
    }
}

fn empty_policy(env: &Env) -> SpendPolicy {
    SpendPolicy {
        require_all_sigs: false,
        daily_limit: None,
        protected_envelopes: Vec::new(env),
    }
}

fn load_policy(env: &Env) -> SpendPolicy {
    env.storage()
        .instance()
        .get(&DataKey::Policy)
        .unwrap_or_else(|| empty_policy(env))
}

fn day_epoch(env: &Env) -> u64 {
    env.ledger().timestamp() / SECONDS_PER_DAY
}

fn daily_spent(env: &Env, caller: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::DailySpent(caller.clone(), day_epoch(env)))
        .unwrap_or(0)
}

fn add_daily_spent(env: &Env, caller: &Address, amount: i128) {
    let key = DataKey::DailySpent(caller.clone(), day_epoch(env));
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage().persistent().set(&key, &(current + amount));
}

/// Returns true if the configured policy requires admin approval for this
/// specific spend.
fn policy_requires_approval(
    env: &Env,
    policy: &SpendPolicy,
    caller: &Address,
    envelope: Envelope,
    amount: i128,
) -> bool {
    if policy.require_all_sigs {
        return true;
    }
    if policy.protected_envelopes.contains(&envelope) {
        return true;
    }
    if let Some(limit) = policy.daily_limit {
        if daily_spent(env, caller) + amount > limit {
            return true;
        }
    }
    false
}

/// Pure execution path — assumes policy + member + amount checks already
/// passed. Transfers tokens, updates the envelope balance, tracks daily
/// spend, and emits the Spend event.
fn execute_spend(
    env: &Env,
    caller: &Address,
    envelope: Envelope,
    amount: i128,
    memo: &String,
) {
    let inst = env.storage().instance();
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();

    let index = envelope.index();
    let current = balances.get(index).unwrap();
    if current < amount {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    token::Client::new(env, &payment_token).transfer(
        &env.current_contract_address(),
        caller,
        &amount,
    );

    balances.set(index, current - amount);
    inst.set(&DataKey::Balances, &balances);

    add_daily_spent(env, caller, amount);

    Spend {
        caller: caller.clone(),
        envelope,
        amount,
        memo: memo.clone(),
    }
    .publish(env);
}

fn create_pending_request(
    env: &Env,
    caller: Address,
    envelope: Envelope,
    amount: i128,
    memo: String,
) -> u64 {
    let inst = env.storage().instance();
    let next_id: u64 = inst.get(&DataKey::NextRequestId).unwrap_or(1);
    inst.set(&DataKey::NextRequestId, &(next_id + 1));

    let request = PendingRequest {
        id: next_id,
        caller: caller.clone(),
        envelope,
        amount,
        memo: memo.clone(),
        requested_at_ledger: env.ledger().sequence(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::Request(next_id), &request);

    let mut active: Vec<u64> = inst
        .get(&DataKey::ActiveRequestIds)
        .unwrap_or(Vec::new(env));
    active.push_back(next_id);
    inst.set(&DataKey::ActiveRequestIds, &active);

    RequestCreated {
        request_id: next_id,
        caller,
        envelope,
        amount,
        memo,
    }
    .publish(env);

    next_id
}

fn remove_active_id(env: &Env, request_id: u64) {
    let inst = env.storage().instance();
    let mut active: Vec<u64> = inst.get(&DataKey::ActiveRequestIds).unwrap_or(Vec::new(env));
    if let Some(idx) = active.first_index_of(request_id) {
        active.remove(idx);
        inst.set(&DataKey::ActiveRequestIds, &active);
    }
}

fn load_active_pending(env: &Env) -> Vec<PendingRequest> {
    let active: Vec<u64> = env
        .storage()
        .instance()
        .get(&DataKey::ActiveRequestIds)
        .unwrap_or(Vec::new(env));
    let mut out = Vec::new(env);
    for id in active.iter() {
        if let Some(req) = env
            .storage()
            .persistent()
            .get::<_, PendingRequest>(&DataKey::Request(id))
        {
            out.push_back(req);
        }
    }
    out
}

// ─── Contract ─────────────────────────────────────────────────────────────

#[contract]
pub struct SobreContract;

#[contractimpl]
impl SobreContract {
    pub fn init(env: Env, admin: Address, payment_token: Address, percents: Vec<u32>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        validate_percents(&env, &percents);

        let inst = env.storage().instance();
        inst.set(&DataKey::Admin, &admin);
        inst.set(&DataKey::PaymentToken, &payment_token);
        inst.set(&DataKey::Percents, &percents);
        inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
        // Members seeded with admin so "is X a member" is a single contains() check.
        inst.set(&DataKey::Members, &vec![&env, admin]);
    }

    /// Admin-only. Append a member (typically the family side). Demo caps total
    /// participants at MAX_MEMBERS (admin counts as one of the two).
    pub fn add_member(env: Env, member: Address) {
        require_admin_auth(&env);

        let inst = env.storage().instance();
        let mut members: Vec<Address> = inst.get(&DataKey::Members).unwrap();
        if members.contains(&member) {
            panic_with_error!(&env, Error::DuplicateMember);
        }
        if members.len() >= MAX_MEMBERS {
            panic_with_error!(&env, Error::MemberLimitReached);
        }
        members.push_back(member);
        inst.set(&DataKey::Members, &members);
    }

    /// Admin-only. Overwrite the envelope percentage split. Only affects how
    /// FUTURE deposits are distributed — existing balances are untouched.
    pub fn set_envelopes(env: Env, percents: Vec<u32>) {
        require_admin_auth(&env);
        validate_percents(&env, &percents);
        env.storage().instance().set(&DataKey::Percents, &percents);
    }

    /// Admin-only. Replace the entire spending policy in one call. Any spend
    /// that lands AFTER this updates against the new policy immediately.
    pub fn set_policy(env: Env, policy: SpendPolicy) {
        require_admin_auth(&env);
        env.storage().instance().set(&DataKey::Policy, &policy);
    }

    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let inst = env.storage().instance();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let percents: Vec<u32> = inst.get(&DataKey::Percents).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();

        token::Client::new(&env, &payment_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        let total = PERCENT_TOTAL as i128;
        let split = |pct: u32| amount * (pct as i128) / total;
        let groceries = split(percents.get(0).unwrap());
        let tuition = split(percents.get(1).unwrap());
        let savings = amount - groceries - tuition;

        inst.set(
            &DataKey::Balances,
            &vec![
                &env,
                balances.get(0).unwrap() + groceries,
                balances.get(1).unwrap() + tuition,
                balances.get(2).unwrap() + savings,
            ],
        );

        Deposit {
            from,
            amount,
            groceries,
            tuition,
            savings,
        }
        .publish(&env);
    }

    /// Members-only. Routes through the configured SpendPolicy:
    /// - if no policy triggers, transfers tokens and emits Spend
    /// - if any policy condition triggers, creates a PendingRequest and emits
    ///   RequestCreated (no transfer; admin must approve_request later)
    pub fn spend(env: Env, caller: Address, envelope: Envelope, amount: i128, memo: String) {
        caller.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        require_member(&env, &caller);

        let policy = load_policy(&env);
        if policy_requires_approval(&env, &policy, &caller, envelope, amount) {
            create_pending_request(&env, caller, envelope, amount, memo);
        } else {
            execute_spend(&env, &caller, envelope, amount, &memo);
        }
    }

    /// Admin-only. Execute a previously created pending request. Emits both
    /// `Spend` (for the transfer) and `RequestApproved` (for correlation).
    pub fn approve_request(env: Env, request_id: u64) {
        require_admin_auth(&env);

        let req: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::Request(request_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RequestNotFound));

        env.storage().persistent().remove(&DataKey::Request(request_id));
        remove_active_id(&env, request_id);

        execute_spend(&env, &req.caller, req.envelope, req.amount, &req.memo);

        RequestApproved { request_id }.publish(&env);
    }

    /// Admin-only. Drop a pending request without transferring anything.
    pub fn deny_request(env: Env, request_id: u64) {
        require_admin_auth(&env);

        if !env
            .storage()
            .persistent()
            .has(&DataKey::Request(request_id))
        {
            panic_with_error!(&env, Error::RequestNotFound);
        }
        env.storage().persistent().remove(&DataKey::Request(request_id));
        remove_active_id(&env, request_id);

        RequestDenied { request_id }.publish(&env);
    }

    /// Polled by both dashboards every 2-3s. Returns admin, payment token,
    /// envelope split + balances, members, the active SpendPolicy, and the
    /// list of pending requests — in one call.
    pub fn get_state(env: Env) -> WalletState {
        let inst = env.storage().instance();
        let admin: Address = inst
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let percents: Vec<u32> = inst.get(&DataKey::Percents).unwrap();
        let members: Vec<Address> = inst.get(&DataKey::Members).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let policy = load_policy(&env);
        let pending = load_active_pending(&env);

        WalletState {
            admin,
            payment_token,
            percents,
            members,
            balances,
            policy,
            pending,
        }
    }
}

mod test;
