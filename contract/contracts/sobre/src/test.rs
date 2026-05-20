#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, vec, Env};

#[test]
fn init_sets_full_state() {
    let env = Env::default();
    let contract_id = env.register(SobreContract, ());
    let client = SobreContractClient::new(&env, &contract_id);

    // `require_auth` succeeds for any address inside the test env once mocked.
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let payment_token = Address::generate(&env);
    let percents = vec![&env, 50u32, 30u32, 20u32];

    client.init(&admin, &payment_token, &percents);

    let state = client.get_state();
    assert_eq!(state.admin, admin);
    assert_eq!(state.payment_token, payment_token);
    assert_eq!(state.percents, percents);
    assert_eq!(state.members.len(), 0);
    assert_eq!(state.balances.len(), 3);
    assert_eq!(state.balances.get(0).unwrap(), 0);
    assert_eq!(state.balances.get(1).unwrap(), 0);
    assert_eq!(state.balances.get(2).unwrap(), 0);
}
