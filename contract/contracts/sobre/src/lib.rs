#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, Env, Vec,
};

const ENVELOPE_COUNT: u32 = 3;
const PERCENT_TOTAL: u32 = 100;
const MAX_MEMBERS: u32 = 2;

// ─── Domain types ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Envelope {
    Groceries,
    Tuition,
    Savings,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Percents,
    Members,
    Balances,
}

/// Composite view returned to the frontend in one call. `balances` is ordered
/// [Groceries, Tuition, Savings] so the dashboard can render alongside
/// `percents` without extra lookups.
#[contracttype]
#[derive(Clone)]
pub struct WalletState {
    pub admin: Address,
    pub payment_token: Address,
    pub percents: Vec<u32>,
    pub members: Vec<Address>,
    pub balances: Vec<i128>,
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

    /// Splits the inflow across envelopes by the stored percentages. The
    /// last envelope absorbs any rounding remainder so `sum(balances) ==
    /// amount`. Emits a `Deposit` event the dashboard filters on for the
    /// live transaction feed.
    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let inst = env.storage().instance();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let percents: Vec<u32> = inst.get(&DataKey::Percents).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();

        // Auth from from.require_auth() above is reused for this nested
        // transfer — no second Freighter popup for the user.
        token::Client::new(&env, &payment_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        // Integer division floors each split; savings absorbs the remainder
        // so the deposit is conserved (no dust loss).
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

    /// Polled by both dashboards every 2-3s. All reads come from instance
    /// storage (cheapest tier, auto-TTL extended on each contract invocation).
    pub fn get_state(env: Env) -> WalletState {
        let inst = env.storage().instance();
        let admin: Address = inst
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let percents: Vec<u32> = inst.get(&DataKey::Percents).unwrap();
        let members: Vec<Address> = inst.get(&DataKey::Members).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();

        WalletState {
            admin,
            payment_token,
            percents,
            members,
            balances,
        }
    }
}

mod test;
