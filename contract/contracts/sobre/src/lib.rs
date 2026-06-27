#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, Bytes, BytesN, Env, String, Vec,
};

const MAX_MEMBERS: u32 = 2;
const MAX_SUBACCOUNTS: u32 = 4;

// ─── Domain types ─────────────────────────────────────────────────────────

/// Variant order is wire contract: the `balances` Vec<i128> is indexed
/// [Groceries, Tuition, Savings]. Reordering would silently break every
/// dashboard reading deployed contracts.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Envelope {
    Groceries,
    Tuition,
    Savings,
}

impl Envelope {
    fn index(self) -> u32 {
        match self {
            Envelope::Groceries => 0,
            Envelope::Tuition => 1,
            Envelope::Savings => 2,
        }
    }
}

/// On-chain a member is just an address. Display + role + family rules
/// (split percents, policy, thresholds, daily limits) all live in Supabase.
/// The contract only cares which addresses are authorized to spend.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Member {
    pub address: Address,
}

/// Supplementary-card holder. A separate identity tier from `Member`:
/// sub-accounts can only spend from their own `balance` (not envelopes),
/// admin tops them up from any envelope via `fund_subaccount`, and admin can
/// flip `locked` to freeze spending instantly. Token custody stays with the
/// contract; this is an internal ledger entry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubAccount {
    pub address: Address,
    pub balance: i128,
    pub locked: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Members,
    Balances,
    /// Address of the SobreFactory that deployed this instance. Read on
    /// `upgrade()` so the admin can opt into the factory's current wasm hash
    /// without having to remember it themselves.
    Factory,
    /// Invite token hash → expires_at_ledger. Key is `sha256(plaintext_token)`
    /// so a passive Soroban indexer can't read the storage entry and redeem
    /// the invite before the legitimate recipient. Deleted by `join_wallet`
    /// on redemption — single-use by construction.
    Invite(BytesN<32>),
    /// Vec<SubAccount> for this family. Distinct from Members so the 2-member
    /// cap stays untouched. Sub-accounts have their own MAX_SUBACCOUNTS cap.
    SubAccounts,
    /// Sub-account invite hash. Parallel to `Invite` but routed through
    /// `join_as_subaccount` so a redeemed token can only ever create a
    /// sub-account, never a member.
    SubAccountInvite(BytesN<32>),
}

#[contracttype]
#[derive(Clone)]
pub struct WalletState {
    pub admin: Address,
    pub payment_token: Address,
    pub members: Vec<Member>,
    pub balances: Vec<i128>,
    pub subaccounts: Vec<SubAccount>,
}

/// Emitted by `deposit_with_split`. Topic list: ("Deposit", from). The
/// per-envelope amounts the CALLER passed in are emitted as-is — they were
/// computed off-chain from the family's Supabase-stored split. The chain
/// stores no "agreed split" because admin can change it freely.
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

/// Emitted by `spend` (self-spend) AND `spend_on_behalf` (admin-released).
/// `caller` is always the member whose envelope was debited.
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

#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteCreated {
    #[topic]
    pub invite_hash: BytesN<32>,
    pub expires_at_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteRedeemed {
    #[topic]
    pub invite_hash: BytesN<32>,
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MemberJoined {
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MemberRemoved {
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletUpgraded {
    pub new_wasm: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletClosed {
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountInviteCreated {
    #[topic]
    pub invite_hash: BytesN<32>,
    pub expires_at_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountJoined {
    #[topic]
    pub subaccount: Address,
}

/// Topic shape mirrors Spend so the activity feed reuses one decoder.
#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountFunded {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountSpent {
    #[topic]
    pub caller: Address,
    pub amount: i128,
    pub memo: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountLockChanged {
    #[topic]
    pub subaccount: Address,
    pub locked: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 6,
    DuplicateMember = 4,
    MemberLimitReached = 5,
    NotAMember = 7,
    InsufficientBalance = 8,
    MemberNotFound = 10,
    CannotRemoveAdmin = 11,
    InviteNotFound = 13,
    InviteExpired = 14,
    SubAccountNotFound = 15,
    SubAccountLocked = 16,
    DuplicateSubAccount = 17,
    SubAccountLimitReached = 18,
}

// ─── Private helpers ──────────────────────────────────────────────────────

fn init_inner(env: Env, admin: Address, payment_token: Address, factory: Address) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(&env, Error::AlreadyInitialized);
    }
    let inst = env.storage().instance();
    inst.set(&DataKey::Admin, &admin);
    inst.set(&DataKey::PaymentToken, &payment_token);
    inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
    inst.set(&DataKey::Factory, &factory);
    let admin_member = Member { address: admin };
    inst.set(&DataKey::Members, &vec![&env, admin_member]);
}

fn require_admin_auth(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    admin.require_auth();
}

fn find_member_index(members: &Vec<Member>, addr: &Address) -> Option<u32> {
    for (i, m) in members.iter().enumerate() {
        if &m.address == addr {
            return Some(i as u32);
        }
    }
    None
}

fn find_subaccount_index(subs: &Vec<SubAccount>, addr: &Address) -> Option<u32> {
    for (i, s) in subs.iter().enumerate() {
        if &s.address == addr {
            return Some(i as u32);
        }
    }
    None
}

fn load_subaccounts(env: &Env) -> Vec<SubAccount> {
    env.storage()
        .instance()
        .get(&DataKey::SubAccounts)
        .unwrap_or_else(|| Vec::new(env))
}

fn set_subaccount_lock(env: &Env, subaccount: &Address, locked: bool) {
    require_admin_auth(env);
    let inst = env.storage().instance();
    let mut subs = load_subaccounts(env);
    let idx = find_subaccount_index(&subs, subaccount)
        .unwrap_or_else(|| panic_with_error!(env, Error::SubAccountNotFound));
    let mut sub = subs.get(idx).unwrap();
    if sub.locked == locked {
        return;
    }
    sub.locked = locked;
    subs.set(idx, sub);
    inst.set(&DataKey::SubAccounts, &subs);
    SubAccountLockChanged {
        subaccount: subaccount.clone(),
        locked,
    }
    .publish(env);
}

fn require_member(env: &Env, addr: &Address) {
    let members: Vec<Member> = env.storage().instance().get(&DataKey::Members).unwrap();
    if find_member_index(&members, addr).is_none() {
        panic_with_error!(env, Error::NotAMember);
    }
}

/// Shared by `spend` and `spend_on_behalf`. Assumes auth + member checks
/// already done. Transfers tokens to `caller`'s wallet, debits the envelope,
/// emits Spend with `caller` as the topic.
fn execute_spend(env: &Env, caller: &Address, envelope: Envelope, amount: i128, memo: &String) {
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
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
    Spend {
        caller: caller.clone(),
        envelope,
        amount,
        memo: memo.clone(),
    }
    .publish(env);
}

// ─── Contract ─────────────────────────────────────────────────────────────

#[contract]
pub struct SobreContract;

#[contractimpl]
impl SobreContract {
    /// Auto-invoked on deploy_v2 by SobreFactory.create_sobre. Manual
    /// deploys call `init` directly with the same args.
    pub fn __constructor(env: Env, admin: Address, payment_token: Address, factory: Address) {
        init_inner(env, admin, payment_token, factory);
    }

    pub fn init(env: Env, admin: Address, payment_token: Address, factory: Address) {
        admin.require_auth();
        init_inner(env, admin, payment_token, factory);
    }

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

    pub fn join_wallet(env: Env, caller: Address, invite_token: BytesN<32>) {
        caller.require_auth();
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::NotInitialized);
        }
        let token_hash: BytesN<32> = env.crypto().sha256(&Bytes::from(invite_token)).into();
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
        });
        inst.set(&DataKey::Members, &members);
        env.storage().persistent().remove(&invite_key);
        MemberJoined {
            member: caller.clone(),
        }
        .publish(&env);
        InviteRedeemed {
            invite_hash: token_hash,
            member: caller,
        }
        .publish(&env);
    }

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

    pub fn close_wallet(env: Env) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let subs = load_subaccounts(&env);
        let mut total: i128 = 0;
        for b in balances.iter() {
            total += b;
        }
        // Sub-account balances are internal ledger entries against the same
        // contract-held token pool. Sweep them with envelopes so closing
        // doesn't leak custody.
        for s in subs.iter() {
            total += s.balance;
        }
        if total > 0 {
            token::Client::new(&env, &payment_token).transfer(
                &env.current_contract_address(),
                &admin,
                &total,
            );
        }
        inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
        if !subs.is_empty() {
            let mut zeroed: Vec<SubAccount> = Vec::new(&env);
            for s in subs.iter() {
                zeroed.push_back(SubAccount {
                    address: s.address.clone(),
                    balance: 0,
                    locked: s.locked,
                });
            }
            inst.set(&DataKey::SubAccounts, &zeroed);
        }
        WalletClosed { total }.publish(&env);
    }

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

    /// Deposit with the per-envelope split already computed off-chain. The
    /// contract pulls (groceries+tuition+savings) tokens via the SAC and
    /// credits each envelope by the amount the caller passed in. The "agreed
    /// split" lives in Supabase — admin can edit it freely without paying
    /// any fee; the next deposit just reflects the latest version.
    pub fn deposit_with_split(
        env: Env,
        from: Address,
        groceries: i128,
        tuition: i128,
        savings: i128,
    ) {
        from.require_auth();
        if groceries < 0 || tuition < 0 || savings < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let total = groceries + tuition + savings;
        if total <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        token::Client::new(&env, &payment_token).transfer(
            &from,
            &env.current_contract_address(),
            &total,
        );
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
            amount: total,
            groceries,
            tuition,
            savings,
        }
        .publish(&env);
    }

    /// Member self-spend. Balance check + transfer to caller + emit. The
    /// approval gate (daily limit, per-tx threshold, protected envelopes)
    /// lives off-chain — the frontend checks Supabase policy before deciding
    /// whether to call this directly or stage an admin-approval request.
    pub fn spend(env: Env, caller: Address, envelope: Envelope, amount: i128, memo: String) {
        caller.require_auth();
        require_member(&env, &caller);
        execute_spend(&env, &caller, envelope, amount, &memo);
    }

    /// Admin-signed release of an approved spend request. The Spend event is
    /// emitted with `member` as the caller topic so the activity feed shows
    /// the request's originator. Tokens land in the member's wallet exactly
    /// as if they had self-spent; from there they complete the cashout
    /// (PDAX) on their own time.
    pub fn spend_on_behalf(
        env: Env,
        member: Address,
        envelope: Envelope,
        amount: i128,
        memo: String,
    ) {
        require_admin_auth(&env);
        require_member(&env, &member);
        execute_spend(&env, &member, envelope, amount, &memo);
    }

    /// Admin mints a sub-account invite. Same sha256-of-plaintext shape as
    /// `create_invite` so an indexer reading storage can't grab the token.
    /// Distinct DataKey variant so a member-side invite can never be redeemed
    /// as a sub-account or vice versa.
    pub fn create_subaccount_invite(env: Env, token_hash: BytesN<32>, expires_at_ledger: u32) {
        require_admin_auth(&env);
        let now = env.ledger().sequence();
        if expires_at_ledger <= now {
            panic_with_error!(&env, Error::InviteExpired);
        }
        let ttl = expires_at_ledger - now;
        let key = DataKey::SubAccountInvite(token_hash.clone());
        env.storage().persistent().set(&key, &expires_at_ledger);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);
        SubAccountInviteCreated {
            invite_hash: token_hash,
            expires_at_ledger,
        }
        .publish(&env);
    }

    /// Sub-account holder redeems an invite. Registers the caller in the
    /// SubAccounts vec with zero balance, unlocked. Reject if already a
    /// member or already a sub-account; sub-accounts and members are
    /// disjoint identity sets.
    pub fn join_as_subaccount(env: Env, caller: Address, invite_token: BytesN<32>) {
        caller.require_auth();
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::NotInitialized);
        }
        let token_hash: BytesN<32> = env.crypto().sha256(&Bytes::from(invite_token)).into();
        let invite_key = DataKey::SubAccountInvite(token_hash.clone());
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
        let members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        if find_member_index(&members, &caller).is_some() {
            panic_with_error!(&env, Error::DuplicateSubAccount);
        }
        let mut subs = load_subaccounts(&env);
        if find_subaccount_index(&subs, &caller).is_some() {
            panic_with_error!(&env, Error::DuplicateSubAccount);
        }
        if subs.len() >= MAX_SUBACCOUNTS {
            panic_with_error!(&env, Error::SubAccountLimitReached);
        }
        subs.push_back(SubAccount {
            address: caller.clone(),
            balance: 0,
            locked: false,
        });
        inst.set(&DataKey::SubAccounts, &subs);
        env.storage().persistent().remove(&invite_key);
        SubAccountJoined {
            subaccount: caller.clone(),
        }
        .publish(&env);
        InviteRedeemed {
            invite_hash: token_hash,
            member: caller,
        }
        .publish(&env);
    }

    /// Admin tops up a sub-account from a specific envelope. Internal ledger
    /// transfer: debits the envelope, credits the sub. No token leaves the
    /// contract — custody stays here until the sub-account holder spends.
    pub fn fund_subaccount(env: Env, envelope: Envelope, recipient: Address, amount: i128) {
        require_admin_auth(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let idx = envelope.index();
        let current = balances.get(idx).unwrap();
        if current < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        let mut subs = load_subaccounts(&env);
        let sub_idx = find_subaccount_index(&subs, &recipient)
            .unwrap_or_else(|| panic_with_error!(&env, Error::SubAccountNotFound));
        balances.set(idx, current - amount);
        let mut sub = subs.get(sub_idx).unwrap();
        sub.balance += amount;
        subs.set(sub_idx, sub);
        inst.set(&DataKey::Balances, &balances);
        inst.set(&DataKey::SubAccounts, &subs);
        SubAccountFunded {
            recipient,
            envelope,
            amount,
        }
        .publish(&env);
    }

    /// Sub-account holder self-spend. Refuses if admin has locked them.
    /// Transfers tokens to caller's wallet; cashout (PDAX) completes from
    /// there, same shape as `spend` for members.
    pub fn spend_from_subaccount(env: Env, caller: Address, amount: i128, memo: String) {
        caller.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let mut subs = load_subaccounts(&env);
        let sub_idx = find_subaccount_index(&subs, &caller)
            .unwrap_or_else(|| panic_with_error!(&env, Error::SubAccountNotFound));
        let mut sub = subs.get(sub_idx).unwrap();
        if sub.locked {
            panic_with_error!(&env, Error::SubAccountLocked);
        }
        if sub.balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        token::Client::new(&env, &payment_token).transfer(
            &env.current_contract_address(),
            &caller,
            &amount,
        );
        sub.balance -= amount;
        subs.set(sub_idx, sub);
        inst.set(&DataKey::SubAccounts, &subs);
        SubAccountSpent {
            caller,
            amount,
            memo,
        }
        .publish(&env);
    }

    pub fn lock_subaccount(env: Env, subaccount: Address) {
        set_subaccount_lock(&env, &subaccount, true);
    }

    pub fn unlock_subaccount(env: Env, subaccount: Address) {
        set_subaccount_lock(&env, &subaccount, false);
    }

    /// Polled by both dashboards. Only on-chain truth — display + family
    /// rules (split, policy, pending requests) live in Supabase and the
    /// dashboard joins them client-side.
    pub fn get_state(env: Env) -> WalletState {
        let inst = env.storage().instance();
        let admin: Address = inst
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let subaccounts = load_subaccounts(&env);
        WalletState {
            admin,
            payment_token,
            members,
            balances,
            subaccounts,
        }
    }
}

mod test;
