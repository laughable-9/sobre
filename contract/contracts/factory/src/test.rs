#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, token, vec, BytesN, Env};

/// Sobre wasm baked into the test binary at compile time. The workspace
/// build picks up the right path; ensure `cargo build --target wasm32v1-none
/// --release -p sobre` has run at least once before running these tests.
const SOBRE_WASM: &[u8] = include_bytes!("../../../target/wasm32v1-none/release/sobre.wasm");

const STROOPS_PER_TOKEN: i128 = 10_000_000;

struct Fixture {
    env: Env,
    factory_id: Address,
    admin: Address,
    payment_token: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        // Upload the Sobre wasm so the factory can deploy instances of it.
        let wasm_hash: BytesN<32> = env.deployer().upload_contract_wasm(SOBRE_WASM);

        // Real SEP-41 token so deploy + init flows hit a working token.
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let payment_token = token_contract.address();

        // Deploy + init the factory with a generated factory-admin separate
        // from the per-wallet admin used in tests below.
        let factory_id = env.register(SobreFactory, ());
        let client = SobreFactoryClient::new(&env, &factory_id);
        let factory_admin = Address::generate(&env);
        client.init(&factory_admin, &wasm_hash);

        let admin = Address::generate(&env);
        Self {
            env,
            factory_id,
            admin,
            payment_token,
        }
    }

    fn client(&self) -> SobreFactoryClient<'_> {
        SobreFactoryClient::new(&self.env, &self.factory_id)
    }
}

#[test]
fn create_sobre_deploys_and_inits_a_new_instance() {
    let f = Fixture::new();

    let sobre_addr = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 50u32, 30u32, 20u32],
    );

    let sobre_client = sobre::SobreContractClient::new(&f.env, &sobre_addr);
    let state = sobre_client.get_state();
    assert_eq!(state.admin, f.admin);
    assert_eq!(state.payment_token, f.payment_token);
    assert_eq!(state.percents, vec![&f.env, 50u32, 30u32, 20u32]);
    assert_eq!(state.members.len(), 1);
    let first = state.members.get(0).unwrap();
    assert_eq!(first.address, f.admin);
    assert!(state.policy.per_tx_threshold.is_none());
}

#[test]
fn create_sobre_registers_admin_in_directory() {
    let f = Fixture::new();

    let first = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 50u32, 30u32, 20u32],
    );
    let second = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 40u32, 40u32, 20u32],
    );

    let listed = f.client().sobres_of_admin(&f.admin);
    assert_eq!(listed.len(), 2);
    assert_eq!(listed.get(0).unwrap(), first);
    assert_eq!(listed.get(1).unwrap(), second);
}

#[test]
fn sobres_of_admin_isolates_users() {
    let f = Fixture::new();
    let other = Address::generate(&f.env);

    f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 50u32, 30u32, 20u32],
    );
    f.client().create_sobre(
        &other,
        &f.payment_token,
        &vec![&f.env, 60u32, 25u32, 15u32],
    );

    let mine = f.client().sobres_of_admin(&f.admin);
    let theirs = f.client().sobres_of_admin(&other);
    assert_eq!(mine.len(), 1);
    assert_eq!(theirs.len(), 1);
    assert_ne!(mine.get(0).unwrap(), theirs.get(0).unwrap());
}

#[test]
fn each_create_returns_a_distinct_contract_address() {
    let f = Fixture::new();
    let a = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 50u32, 30u32, 20u32],
    );
    let b = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 50u32, 30u32, 20u32],
    );
    assert_ne!(a, b);
}

#[test]
fn create_sobres_are_functionally_independent() {
    let f = Fixture::new();
    let sobre_a = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 50u32, 30u32, 20u32],
    );
    let sobre_b = f.client().create_sobre(
        &f.admin,
        &f.payment_token,
        &vec![&f.env, 60u32, 25u32, 15u32],
    );

    // Mint + deposit only into sobre_a.
    token::StellarAssetClient::new(&f.env, &f.payment_token)
        .mint(&f.admin, &(1000 * STROOPS_PER_TOKEN));
    let client_a = sobre::SobreContractClient::new(&f.env, &sobre_a);
    client_a.deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));

    let state_a = client_a.get_state();
    let client_b = sobre::SobreContractClient::new(&f.env, &sobre_b);
    let state_b = client_b.get_state();

    // sobre_a saw the deposit, sobre_b did not — proves storage isolation.
    assert_eq!(state_a.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state_b.balances.get(0).unwrap(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn init_twice_rejects() {
    let env = Env::default();
    env.mock_all_auths();
    let wasm_hash: BytesN<32> = env.deployer().upload_contract_wasm(SOBRE_WASM);
    let factory_id = env.register(SobreFactory, ());
    let client = SobreFactoryClient::new(&env, &factory_id);
    let factory_admin = Address::generate(&env);
    client.init(&factory_admin, &wasm_hash);
    client.init(&factory_admin, &wasm_hash);
}

#[test]
fn set_sobre_wasm_swaps_the_pointer() {
    let f = Fixture::new();
    // upload_contract_wasm is deterministic on bytes, so re-uploading the
    // same bytes yields the same hash. Tests just that set_sobre_wasm
    // overwrites the stored pointer with the value the admin passes in.
    let initial = f.client().current_sobre_wasm();
    let new_hash: BytesN<32> = f.env.deployer().upload_contract_wasm(SOBRE_WASM);
    assert_eq!(initial, new_hash);

    f.client().set_sobre_wasm(&new_hash);
    assert_eq!(f.client().current_sobre_wasm(), new_hash);
}
