#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    Address, BytesN, Env, String, Vec,
};

// ─── Domain types ─────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// The SobreContract wasm hash this factory deploys instances of.
    Wasm,
    /// Monotonic counter used to derive a unique salt for every deploy.
    NextSalt,
    /// admin → Vec<Address> of Sobre contracts they have created. Lets the
    /// "My Sobres" landing page list every wallet a user opened, without an
    /// off-chain indexer.
    AdminSobres(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SobreCreated {
    #[topic]
    pub admin: Address,
    #[topic]
    pub contract: Address,
    pub wallet_name: String,
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/// 32-byte salt derived from a monotonic counter. Padded with leading zeros
/// so the last 8 bytes are the counter's big-endian representation — this
/// keeps the derivation trivial to reason about and trivially collision-free
/// for the lifetime of any single factory instance.
fn next_salt(env: &Env) -> BytesN<32> {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextSalt)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::NextSalt, &(counter + 1));

    let mut bytes = [0u8; 32];
    bytes[24..].copy_from_slice(&counter.to_be_bytes());
    BytesN::from_array(env, &bytes)
}

fn load_wasm(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&DataKey::Wasm)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn push_admin_sobre(env: &Env, admin: &Address, contract: &Address) {
    let key = DataKey::AdminSobres(admin.clone());
    let mut list: Vec<Address> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    list.push_back(contract.clone());
    env.storage().persistent().set(&key, &list);
}

// ─── Contract ─────────────────────────────────────────────────────────────

#[contract]
pub struct SobreFactory;

#[contractimpl]
impl SobreFactory {
    /// One-time setup: bind the SobreContract wasm hash this factory will
    /// deploy. The deployer is implicitly the factory owner (no privileged
    /// upgrades wired here for the demo — set once, immutable until v2).
    pub fn init(env: Env, sobre_wasm: BytesN<32>) {
        if env.storage().instance().has(&DataKey::Wasm) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Wasm, &sobre_wasm);
    }

    /// Deploy a new SobreContract instance and call its `init` with the
    /// caller as the admin. Returns the freshly deployed contract address.
    ///
    /// The init constructor is supplied as part of the deploy_v2 call so the
    /// new contract is fully usable when this function returns — no separate
    /// "deploy then init" race window where a third party could intercept.
    pub fn create_sobre(
        env: Env,
        admin: Address,
        payment_token: Address,
        percents: Vec<u32>,
        envelope_names: Vec<String>,
        wallet_name: String,
        admin_name: String,
        admin_emoji: String,
    ) -> Address {
        admin.require_auth();

        let wasm = load_wasm(&env);
        let salt = next_salt(&env);

        let constructor_args = (
            admin.clone(),
            payment_token,
            percents,
            envelope_names,
            wallet_name.clone(),
            admin_name,
            admin_emoji,
        );

        let new_contract = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, constructor_args);

        push_admin_sobre(&env, &admin, &new_contract);

        SobreCreated {
            admin,
            contract: new_contract.clone(),
            wallet_name,
        }
        .publish(&env);

        new_contract
    }

    /// View. Lists every Sobre this address has created via this factory.
    /// Used by the "My Sobres" landing page to render the admin's wallets
    /// without scanning chain history.
    pub fn sobres_of_admin(env: Env, admin: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AdminSobres(admin))
            .unwrap_or(Vec::new(&env))
    }
}

mod test;
