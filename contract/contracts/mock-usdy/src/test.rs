#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use crate::{MockUSDY, MockUSDYClient};

const YEAR_SECS: u64 = 365 * 24 * 3600;

fn setup(env: &Env) -> (MockUSDYClient<'_>, Address, StellarAssetClient<'_>, TokenClient<'_>) {
    let underlying = env.register_stellar_asset_contract_v2(Address::generate(env));
    let sac_client = StellarAssetClient::new(env, &underlying.address());
    let token_client = TokenClient::new(env, &underlying.address());

    let usdy_id = env.register(MockUSDY, ());
    let usdy = MockUSDYClient::new(env, &usdy_id);
    usdy.init(&underlying.address());

    (usdy, usdy_id, sac_client, token_client)
}

/// Deposit + immediate balance read: appreciation has had zero seconds to
/// accrue, so balance == amount deposited (no yield yet).
#[test]
fn deposit_records_principal() {
    let env = Env::default();
    env.mock_all_auths();
    let (usdy, _usdy_id, sac, token) = setup(&env);
    let user = Address::generate(&env);

    sac.mint(&user, &1_000_000_000); // 100 USDC
    usdy.deposit(&user, &1_000_000_000);

    assert_eq!(usdy.balance_of(&user), 1_000_000_000);
    assert_eq!(token.balance(&user), 0);
}

/// Time-travel a year at 5% APY: 1,000_000_000 principal should read as
/// 1,050_000_000 balance. Confirms the appreciation math and the ledger
/// timestamp hook both work.
#[test]
fn appreciation_accrues_over_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (usdy, usdy_id, sac, _) = setup(&env);
    let user = Address::generate(&env);

    sac.mint(&user, &1_000_000_000);
    usdy.deposit(&user, &1_000_000_000);

    env.ledger().with_mut(|l| l.timestamp += YEAR_SECS);

    // Fund the contract's underlying reserve so redeem can pay out the
    // interest portion. Deposit already put 1_000_000_000 in; add the extra
    // 5% we'll need to pay accrued yield.
    sac.mint(&usdy_id, &50_000_000);

    let balance = usdy.balance_of(&user);
    assert_eq!(balance, 1_050_000_000, "5% APY over 1 year");
}

/// Redeem burns from appreciated balance and pays out underlying. The
/// remaining principal is settled (appreciated then reduced) so subsequent
/// balance reads are consistent.
#[test]
fn redeem_pays_appreciated_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (usdy, usdy_id, sac, token) = setup(&env);
    let user = Address::generate(&env);

    sac.mint(&user, &1_000_000_000);
    usdy.deposit(&user, &1_000_000_000);
    sac.mint(&usdy_id, &50_000_000);

    env.ledger().with_mut(|l| l.timestamp += YEAR_SECS);

    usdy.redeem(&user, &500_000_000);

    // User got 500_000_000 stroops back.
    assert_eq!(token.balance(&user), 500_000_000);
    // Remaining balance: 1_050_000_000 (appreciated) − 500_000_000 = 550_000_000.
    assert_eq!(usdy.balance_of(&user), 550_000_000);
}

/// Redeeming more than the current appreciated balance panics with
/// InsufficientBalance rather than silently overdrawing.
#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn redeem_over_balance_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (usdy, _usdy_id, sac, _) = setup(&env);
    let user = Address::generate(&env);

    sac.mint(&user, &100);
    usdy.deposit(&user, &100);
    usdy.redeem(&user, &101);
}

/// Zero-amount deposit is rejected — protects against accidental no-ops that
/// still burn CPU and emit misleading events.
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn deposit_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (usdy, _, sac, _) = setup(&env);
    let user = Address::generate(&env);

    sac.mint(&user, &1_000);
    usdy.deposit(&user, &0);
}
