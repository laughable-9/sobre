#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, Bytes, BytesN, Env, String, Vec,
};

const ENVELOPE_COUNT: u32 = 3;
const PERCENT_TOTAL: u32 = 100;
const MAX_MEMBERS: u32 = 2;
const SECONDS_PER_DAY: u64 = 86_400;
const MAX_ENVELOPE_NAME_LEN: u32 = 24;

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

/// Profile travels with the address everywhere we render a member — name
/// shows in summary/activity/feed, emoji is the avatar. The frontend allows
/// only a curated emoji set (mango, palm, flower, money, star, sun) so this
/// stays a tiny string per row.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Member {
    pub address: Address,
    pub name: String,
    pub emoji: String,
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
    WalletName,
    EnvelopeNames,
    /// (caller, day_epoch) → cumulative spent that day. Day epoch is
    /// `ledger.timestamp() / SECONDS_PER_DAY`, so each new UTC day starts a
    /// fresh counter without explicit reset.
    DailySpent(Address, u64),
    /// Address of the SobreFactory that deployed this instance. Read on
    /// `upgrade()` so the admin can opt into the factory's current wasm hash
    /// without having to remember it themselves.
    Factory,
    /// Invite token hash → expires_at_ledger. Key is `sha256(plaintext_token)`
    /// (not the plaintext itself) so a passive Soroban indexer can't read the
    /// storage entry and redeem the invite before the legitimate recipient.
    /// Deleted by `join_wallet` on redemption — single-use by construction.
    Invite(BytesN<32>),
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
    pub wallet_name: String,
    pub envelope_names: Vec<String>,
    pub percents: Vec<u32>,
    pub members: Vec<Member>,
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

/// Emitted when admin creates a single-use invite token. The hash topic lets
/// the admin's dashboard correlate the create_invite tx with the eventual
/// InviteRedeemed event without needing to store the plaintext server-side.
#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteCreated {
    #[topic]
    pub invite_hash: BytesN<32>,
    pub expires_at_ledger: u32,
}

/// Emitted when a non-admin redeems an invite token to join. Pairs with
/// InviteCreated by the matching invite_hash topic. The joiner's profile +
/// address are also captured by the MemberJoined event that fires alongside.
#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteRedeemed {
    #[topic]
    pub invite_hash: BytesN<32>,
    #[topic]
    pub member: Address,
}

/// Emitted when a non-admin self-joins via the invite-link flow.
#[contractevent]
#[derive(Clone, Debug)]
pub struct MemberJoined {
    #[topic]
    pub member: Address,
    pub name: String,
    pub emoji: String,
}

/// Emitted when admin kicks a member.
#[contractevent]
#[derive(Clone, Debug)]
pub struct MemberRemoved {
    #[topic]
    pub member: Address,
}

/// Emitted when admin renames the wallet via `set_wallet_name`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletRenamed {
    pub new_name: String,
}

/// Emitted when admin renames the envelopes via `set_envelope_names`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct EnvelopesRenamed {
    pub names: Vec<String>,
}

/// Emitted when the admin opts this Sobre into a new wasm via `upgrade`.
/// The new code takes effect on the next invocation; storage is unchanged.
#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletUpgraded {
    pub new_wasm: BytesN<32>,
}

/// Emitted when admin closes the wallet via `close_wallet`. Records the
/// total stroops swept back to admin so the activity feed can render
/// "₱X swept to admin · wallet closed" without re-reading balances.
#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletClosed {
    pub total: i128,
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
    MemberNotFound = 10,
    CannotRemoveAdmin = 11,
    InvalidEnvelopeNames = 12,
    InviteNotFound = 13,
    InviteExpired = 14,
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

fn validate_envelope_names(env: &Env, names: &Vec<String>) {
    if names.len() != ENVELOPE_COUNT {
        panic_with_error!(env, Error::InvalidEnvelopeNames);
    }
    for n in names.iter() {
        let len = n.len();
        if len == 0 || len > MAX_ENVELOPE_NAME_LEN {
            panic_with_error!(env, Error::InvalidEnvelopeNames);
        }
    }
}

/// Shared body for `init` and `__constructor`. Skips the `admin.require_auth()`
/// check because both public callers (the auth-required `init` and the
/// factory's `__constructor` whose admin auth is already verified upstream)
/// arrive here with the same args and the same intent — set this contract
/// up once and never again.
fn init_inner(
    env: Env,
    admin: Address,
    payment_token: Address,
    percents: Vec<u32>,
    envelope_names: Vec<String>,
    wallet_name: String,
    admin_name: String,
    admin_emoji: String,
    factory: Address,
) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(&env, Error::AlreadyInitialized);
    }
    validate_percents(&env, &percents);
    validate_envelope_names(&env, &envelope_names);

    let inst = env.storage().instance();
    inst.set(&DataKey::Admin, &admin);
    inst.set(&DataKey::PaymentToken, &payment_token);
    inst.set(&DataKey::Percents, &percents);
    inst.set(&DataKey::EnvelopeNames, &envelope_names);
    inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
    inst.set(&DataKey::WalletName, &wallet_name);
    inst.set(&DataKey::Factory, &factory);

    let admin_member = Member {
        address: admin,
        name: admin_name,
        emoji: admin_emoji,
    };
    inst.set(&DataKey::Members, &vec![&env, admin_member]);
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

fn is_admin(env: &Env, addr: &Address) -> bool {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    &admin == addr
}

fn find_member_index(members: &Vec<Member>, addr: &Address) -> Option<u32> {
    for (i, m) in members.iter().enumerate() {
        if &m.address == addr {
            return Some(i as u32);
        }
    }
    None
}

fn require_member(env: &Env, addr: &Address) {
    let members: Vec<Member> = env.storage().instance().get(&DataKey::Members).unwrap();
    if find_member_index(&members, addr).is_none() {
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

/// Admin spends never touch the daily counter — see `policy_requires_approval`
/// for the matching bypass on the gate-check side.
fn add_daily_spent(env: &Env, caller: &Address, amount: i128) {
    if is_admin(env, caller) {
        return;
    }
    let key = DataKey::DailySpent(caller.clone(), day_epoch(env));
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage().persistent().set(&key, &(current + amount));
}

/// Returns true if the configured policy requires admin approval for this
/// specific spend. Admin is always exempt: their spends are the trusted-OFW
/// transactions the demo's policy is designed to guard against, not block.
fn policy_requires_approval(
    env: &Env,
    policy: &SpendPolicy,
    caller: &Address,
    envelope: Envelope,
    amount: i128,
) -> bool {
    if is_admin(env, caller) {
        return false;
    }
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
    /// Auto-invoked on deploy_v2 with the constructor args, so the
    /// SobreFactory can deploy + init atomically (no front-run window).
    /// Manual deploys can still call `init` directly with the same args.
    ///
    /// The constructor calls `init_inner` (no auth check) instead of the
    /// public `init`. Admin's intent is already verified at the factory
    /// layer by `create_sobre`'s `admin.require_auth()`; requiring it again
    /// here would produce a nested two-context auth tree that's awkward
    /// for passkey-signed wallets to authorize in a single signature.
    pub fn __constructor(
        env: Env,
        admin: Address,
        payment_token: Address,
        percents: Vec<u32>,
        envelope_names: Vec<String>,
        wallet_name: String,
        admin_name: String,
        admin_emoji: String,
        factory: Address,
    ) {
        init_inner(
            env,
            admin,
            payment_token,
            percents,
            envelope_names,
            wallet_name,
            admin_name,
            admin_emoji,
            factory,
        );
    }

    /// One-time setup for manual (non-factory) deploys. Requires admin
    /// authorization explicitly because there's no factory upstream to
    /// have done it. Factory-deployed instances skip this path via
    /// `__constructor` → `init_inner`.
    ///
    /// `factory` is the SobreFactory that deployed this instance (or zero
    /// address for manual deploys); `upgrade()` reads its
    /// `current_sobre_wasm` view to opt this Sobre into the latest
    /// contract code without trusting the admin to pass the right hash
    /// by hand.
    pub fn init(
        env: Env,
        admin: Address,
        payment_token: Address,
        percents: Vec<u32>,
        envelope_names: Vec<String>,
        wallet_name: String,
        admin_name: String,
        admin_emoji: String,
        factory: Address,
    ) {
        admin.require_auth();
        init_inner(
            env,
            admin,
            payment_token,
            percents,
            envelope_names,
            wallet_name,
            admin_name,
            admin_emoji,
            factory,
        );
    }

    /// Admin-only. Persists a single-use invite token that the admin's client
    /// generated off-chain. The contract stores `sha256(plaintext)` rather
    /// than the plaintext so a Soroban indexer reading the storage entry
    /// can't redeem the invite; only the URL recipient (who holds the
    /// plaintext) can. The persistent entry's TTL is extended to cover the
    /// expiry window so it's still readable at redemption time.
    pub fn create_invite(env: Env, token_hash: BytesN<32>, expires_at_ledger: u32) {
        require_admin_auth(&env);

        let now = env.ledger().sequence();
        if expires_at_ledger <= now {
            panic_with_error!(&env, Error::InviteExpired);
        }
        let ttl = expires_at_ledger - now;

        let key = DataKey::Invite(token_hash.clone());
        env.storage().persistent().set(&key, &expires_at_ledger);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);

        InviteCreated {
            invite_hash: token_hash,
            expires_at_ledger,
        }
        .publish(&env);
    }

    /// Self-service join used by the invite-link flow. Caller must present
    /// the plaintext invite token whose `sha256` was previously stored by
    /// `create_invite`. The entry is deleted on redemption so each token is
    /// single-use; the 2-member cap is the demo's safety net even though
    /// the invite gate already enforces it.
    pub fn join_wallet(
        env: Env,
        caller: Address,
        name: String,
        emoji: String,
        invite_token: BytesN<32>,
    ) {
        caller.require_auth();
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::NotInitialized);
        }

        let token_hash: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from(invite_token))
            .into();
        let invite_key = DataKey::Invite(token_hash.clone());
        let expires_at_ledger: u32 = env
            .storage()
            .persistent()
            .get(&invite_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InviteNotFound));
        if env.ledger().sequence() > expires_at_ledger {
            env.storage().persistent().remove(&invite_key);
            panic_with_error!(&env, Error::InviteExpired);
        }

        let inst = env.storage().instance();
        let mut members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        if find_member_index(&members, &caller).is_some() {
            panic_with_error!(&env, Error::DuplicateMember);
        }
        if members.len() >= MAX_MEMBERS {
            panic_with_error!(&env, Error::MemberLimitReached);
        }
        members.push_back(Member {
            address: caller.clone(),
            name: name.clone(),
            emoji: emoji.clone(),
        });
        inst.set(&DataKey::Members, &members);

        env.storage().persistent().remove(&invite_key);

        MemberJoined {
            member: caller.clone(),
            name,
            emoji,
        }
        .publish(&env);
        InviteRedeemed {
            invite_hash: token_hash,
            member: caller,
        }
        .publish(&env);
    }

    /// Admin-only. Kicks a member out of the wallet. The admin cannot kick
    /// themselves — `close_wallet` is the right tool for shutting down.
    pub fn remove_member(env: Env, member: Address) {
        require_admin_auth(&env);

        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        if member == admin {
            panic_with_error!(&env, Error::CannotRemoveAdmin);
        }

        let mut members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        let idx = find_member_index(&members, &member)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MemberNotFound));
        members.remove(idx);
        inst.set(&DataKey::Members, &members);

        MemberRemoved { member }.publish(&env);
    }

    /// Admin-only. Renames the wallet (the "Pagunsan Family" string at the
    /// top of both dashboards).
    pub fn set_wallet_name(env: Env, new_name: String) {
        require_admin_auth(&env);
        env.storage().instance().set(&DataKey::WalletName, &new_name);
        WalletRenamed {
            new_name: new_name.clone(),
        }
        .publish(&env);
    }

    /// Admin-only. Sweeps every envelope balance back to admin in a single
    /// SEP-41 transfer and zeroes the envelopes. The wallet remains callable
    /// — re-depositing would re-split per the current percentages — but for
    /// the demo this represents "closing the wallet."
    pub fn close_wallet(env: Env) {
        require_admin_auth(&env);

        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();

        let mut total: i128 = 0;
        for b in balances.iter() {
            total += b;
        }

        if total > 0 {
            token::Client::new(&env, &payment_token).transfer(
                &env.current_contract_address(),
                &admin,
                &total,
            );
        }

        inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);

        WalletClosed { total }.publish(&env);
    }

    /// Admin-only. Opt this Sobre into the factory's current SobreContract
    /// wasm. Same contract address, same storage, new code on the next call.
    /// Reads the target hash from the factory rather than taking it as an
    /// argument so the admin can't fat-finger a wrong or malicious wasm.
    ///
    /// Trust assumption: whoever holds the factory's admin key controls what
    /// wasm this Sobre adopts on `upgrade()`. Move the factory admin to a
    /// multisig + timelock before mainnet.
    pub fn upgrade(env: Env) {
        require_admin_auth(&env);
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::Factory)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let new_wasm: BytesN<32> = env.invoke_contract(
            &factory,
            &soroban_sdk::Symbol::new(&env, "current_sobre_wasm"),
            soroban_sdk::Vec::new(&env),
        );
        env.deployer().update_current_contract_wasm(new_wasm.clone());
        WalletUpgraded { new_wasm }.publish(&env);
    }

    /// Admin-only. Overwrite the envelope percentage split. Only affects how
    /// FUTURE deposits are distributed — existing balances are untouched.
    pub fn set_envelopes(env: Env, percents: Vec<u32>) {
        require_admin_auth(&env);
        validate_percents(&env, &percents);
        env.storage().instance().set(&DataKey::Percents, &percents);
    }

    /// Admin-only. Rename the three envelopes. Purely cosmetic — the on-chain
    /// `Envelope::Groceries|Tuition|Savings` enum still indexes balances and
    /// policies, so existing pending requests + balances stay valid.
    pub fn set_envelope_names(env: Env, names: Vec<String>) {
        require_admin_auth(&env);
        validate_envelope_names(&env, &names);
        env.storage()
            .instance()
            .set(&DataKey::EnvelopeNames, &names);
        EnvelopesRenamed { names }.publish(&env);
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
    /// - if no policy triggers (or the caller is admin), transfers tokens
    ///   and emits Spend
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
    /// wallet name, envelope split + balances, profiled members, the active
    /// SpendPolicy, and the list of pending requests — in one call.
    pub fn get_state(env: Env) -> WalletState {
        let inst = env.storage().instance();
        let admin: Address = inst
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let wallet_name: String = inst.get(&DataKey::WalletName).unwrap();
        let envelope_names: Vec<String> = inst.get(&DataKey::EnvelopeNames).unwrap();
        let percents: Vec<u32> = inst.get(&DataKey::Percents).unwrap();
        let members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let policy = load_policy(&env);
        let pending = load_active_pending(&env);

        WalletState {
            admin,
            payment_token,
            wallet_name,
            envelope_names,
            percents,
            members,
            balances,
            policy,
            pending,
        }
    }
}

mod test;
