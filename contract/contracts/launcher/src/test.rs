#![cfg(test)]
use super::*;
use blend_contract_sdk::{
    pool as blend_pool,
    testutils::{default_reserve_config, BlendFixture},
};
use mock_usdy::{MockUSDY, MockUSDYClient};
use sobre_factory::{SobreFactory, SobreFactoryClient};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, BytesN as _},
    BytesN, Env, String, Symbol,
};

/// Sobre wasm baked into the test binary at compile time, same pattern as
/// the factory's tests. Run `stellar contract build` (or
/// `cargo build --target wasm32v1-none --release -p sobre`) once first.
const SOBRE_WASM: &[u8] = include_bytes!("../../../target/wasm32v1-none/release/sobre.wasm");

struct Fixture {
    env: Env,
    launcher: Address,
    factory: Address,
    admin: Address,
    payment_token: Address,
    pool: Address,
    xlm_asset: Address,
    soroswap_router: Address,
    usdy: Address,
}

impl Fixture {
    /// Factory + a real-enough Blend pool (grow_enable probes
    /// `pool.get_reserve(xlm_asset)`) + MockUSDY wrapping the payment token.
    /// The Soroswap router is a bare generated address: grow_enable only
    /// pins it, no swap happens at enable time.
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let wasm_hash: BytesN<32> = env.deployer().upload_contract_wasm(SOBRE_WASM);

        let deployer = Address::generate(&env);
        let payment_token = env
            .register_stellar_asset_contract_v2(deployer.clone())
            .address();
        let xlm_asset = env
            .register_stellar_asset_contract_v2(deployer.clone())
            .address();
        let blnd = env
            .register_stellar_asset_contract_v2(deployer.clone())
            .address();
        let usdc_blend = env
            .register_stellar_asset_contract_v2(deployer.clone())
            .address();
        let blend = BlendFixture::deploy(&env, &deployer, &blnd, &usdc_blend);
        let pool = blend.pool_factory.mock_all_auths().deploy(
            &deployer,
            &String::from_str(&env, "sobre-launcher-test"),
            &BytesN::<32>::random(&env),
            &Address::generate(&env),
            &0_1000000,
            &4,
            &1_0000000,
        );
        let pool_client = blend_pool::Client::new(&env, &pool);
        pool_client
            .mock_all_auths()
            .queue_set_reserve(&xlm_asset, &default_reserve_config());
        pool_client.mock_all_auths().set_reserve(&xlm_asset);

        let factory = env.register(SobreFactory, ());
        let factory_admin = Address::generate(&env);
        SobreFactoryClient::new(&env, &factory).init(&factory_admin, &wasm_hash);

        let usdy = env.register(MockUSDY, ());
        MockUSDYClient::new(&env, &usdy).init(&payment_token);

        let launcher = env.register(SobreLauncher, ());
        let admin = Address::generate(&env);
        let soroswap_router = Address::generate(&env);

        Self {
            env,
            launcher,
            factory,
            admin,
            payment_token,
            pool,
            xlm_asset,
            soroswap_router,
            usdy,
        }
    }

    fn create(&self, usdy: Option<Address>) -> Address {
        SobreLauncherClient::new(&self.env, &self.launcher).create_sobre_full(
            &self.admin,
            &self.factory,
            &self.payment_token,
            &self.pool,
            &self.xlm_asset,
            &self.soroswap_router,
            &usdy,
        )
    }
}

#[test]
fn create_sobre_full_deploys_with_grow_and_earn_enabled() {
    let f = Fixture::new();

    let sobre_addr = f.create(Some(f.usdy.clone()));

    let state = sobre::SobreContractClient::new(&f.env, &sobre_addr).get_state();
    assert_eq!(state.admins.get(0).unwrap(), f.admin);
    assert_eq!(state.payment_token, f.payment_token);
    assert!(state.grow_enabled);
    assert_eq!(state.earn.len(), 1);
}

#[test]
fn create_sobre_full_without_usdy_skips_earn() {
    let f = Fixture::new();

    let sobre_addr = f.create(None);

    let state = sobre::SobreContractClient::new(&f.env, &sobre_addr).get_state();
    assert!(state.grow_enabled);
    assert_eq!(state.earn.len(), 0);
}

#[test]
fn create_sobre_full_records_in_factory_directory() {
    let f = Fixture::new();

    let sobre_addr = f.create(Some(f.usdy.clone()));

    let listed = SobreFactoryClient::new(&f.env, &f.factory).sobres_of_admin(&f.admin);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed.get(0).unwrap(), sobre_addr);
}

#[test]
fn create_sobre_full_needs_only_one_admin_auth_entry() {
    // The launcher's whole reason to exist: the admin signs ONE auth entry
    // whose tree covers factory create + grow_enable + earn_enable, so a
    // passkey smart wallet prompts once. If a future sobre/factory change
    // split these into separate root entries, the web app would silently
    // regress to three Face ID prompts — this pins the tree shape.
    let f = Fixture::new();

    f.create(Some(f.usdy.clone()));

    let auths = f.env.auths();
    let mut admin_entries = auths.iter().filter(|(who, _)| who == &f.admin);
    let (_, root) = admin_entries.next().expect("no auth entry for admin");
    assert!(
        admin_entries.next().is_none(),
        "admin required more than one auth entry"
    );
    match root.function.clone() {
        AuthorizedFunction::Contract((addr, fn_name, _)) => {
            assert_eq!(addr, f.launcher);
            assert_eq!(fn_name, Symbol::new(&f.env, "create_sobre_full"));
        }
        _ => panic!("expected a contract-invocation auth root"),
    }
    assert_eq!(root.sub_invocations.len(), 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn create_sobre_full_rejects_usdy_with_wrong_underlying() {
    // earn_enable checks usdy.underlying() == payment_token; a mismatched
    // wrapper must trap the whole create rather than enable a broken Earn.
    let f = Fixture::new();
    let other_admin = Address::generate(&f.env);
    let other_token = f
        .env
        .register_stellar_asset_contract_v2(other_admin)
        .address();
    let bad_usdy = f.env.register(MockUSDY, ());
    MockUSDYClient::new(&f.env, &bad_usdy).init(&other_token);

    f.create(Some(bad_usdy));
}
