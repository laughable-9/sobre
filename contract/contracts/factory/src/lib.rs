#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    Address, BytesN, Env, String, Vec,
};

// ─── Domain types ─────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// The SobreContract wasm hash this factory currently deploys instances of.
    /// Swappable by the admin via `set_sobre_wasm` so new families get the
    /// latest contract code without redeploying the factory itself.
    Wasm,
    /// Monotonic counter used to derive a unique salt for every deploy.
    NextSalt,
    /// admin → Vec<Address> of Sobre contracts they have created.
    AdminSobres(Address),
    /// Factory owner. Has rights to flip the wasm pointer.
    Admin,
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

/// Emitted when the admin swaps the SobreContract wasm hash that future
/// deploys (and per-instance upgrades) will pick up.
#[contractevent]
#[derive(Clone, Debug)]
pub struct WasmUpdated {
    pub new_wasm: BytesN<32>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/// 32-byte salt derived from a monotonic counter. Padded with leading zeros
/// so the last 8 bytes are the counter's big-endian representation.
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

fn require_admin_auth(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    admin.require_auth();
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
    /// One-time setup. Binds the SobreContract wasm hash this factory deploys
    /// + the factory admin (the only address allowed to swap that wasm hash
    /// later). For the hackathon the admin is a single key; production should
    /// move this to a Stellar multisig or a governance contract.
    pub fn init(env: Env, admin: Address, sobre_wasm: BytesN<32>) {
        if env.storage().instance().has(&DataKey::Wasm) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Wasm, &sobre_wasm);
    }

    /// Admin-only. Swap the SobreContract wasm hash future `create_sobre`
    /// calls and existing per-instance `upgrade()` calls will pick up. Same
    /// factory address, same `AdminSobres` directory, new code for new + opted-in
    /// instances.
    pub fn set_sobre_wasm(env: Env, new_wasm: BytesN<32>) {
        require_admin_auth(&env);
        env.storage().instance().set(&DataKey::Wasm, &new_wasm);
        WasmUpdated {
            new_wasm: new_wasm.clone(),
        }
        .publish(&env);
    }

    /// View. The wasm hash a fresh `create_sobre` would deploy right now, and
    /// the hash an existing SobreContract's `upgrade()` will read.
    pub fn current_sobre_wasm(env: Env) -> BytesN<32> {
        load_wasm(&env)
    }

    /// Deploy a new SobreContract instance and call its constructor with the
    /// caller as admin. Returns the freshly deployed contract address. The
    /// factory's own address is supplied as the last constructor arg so the
    /// new instance knows where to ask for its current wasm hash on upgrade.
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
        let factory = env.current_contract_address();

        let constructor_args = (
            admin.clone(),
            payment_token,
            percents,
            envelope_names,
            wallet_name.clone(),
            admin_name,
            admin_emoji,
            factory,
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
    pub fn sobres_of_admin(env: Env, admin: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AdminSobres(admin))
            .unwrap_or(Vec::new(&env))
    }
}

mod test;
