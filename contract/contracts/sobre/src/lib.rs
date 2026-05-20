#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, vec, Address, Env, Vec,
};

const ENVELOPE_COUNT: u32 = 3;
const PERCENT_TOTAL: u32 = 100;

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

/// Explicit discriminants pin the wire format. Frontends match on these
/// numeric codes — do not renumber or reorder.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidPercents = 3,
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

        // Percents: exactly 3 values summing to 100, one per envelope.
        if percents.len() != ENVELOPE_COUNT {
            panic_with_error!(&env, Error::InvalidPercents);
        }
        let sum: u32 = percents.iter().sum();
        if sum != PERCENT_TOTAL {
            panic_with_error!(&env, Error::InvalidPercents);
        }

        let inst = env.storage().instance();
        inst.set(&DataKey::Admin, &admin);
        inst.set(&DataKey::PaymentToken, &payment_token);
        inst.set(&DataKey::Percents, &percents);
        inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
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
        let members: Vec<Address> = inst.get(&DataKey::Members).unwrap_or(Vec::new(&env));
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
