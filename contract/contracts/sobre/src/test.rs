#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, vec, Env,
};

/// SEP-41 tokens on Stellar use 7 decimals. 1 token = 10_000_000 stroops.
const STROOPS_PER_TOKEN: i128 = 10_000_000;

/// All tests start from "initialized wallet with admin + default 50/30/20
/// split + a real SEP-41 payment token alice can mint and deposit." The
/// token is a real Stellar Asset Contract registered in the test env so
/// `deposit()` can exercise the live SEP-41 sub-call path.
struct Fixture {
    env: Env,
    contract_id: Address,
    admin: Address,
    payment_token: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        // Real Stellar Asset Contract so token::Client::transfer in deposit()
        // actually hits a working SEP-41 token implementation.
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let payment_token = token_contract.address();

        let contract_id = env.register(SobreContract, ());
        let admin = Address::generate(&env);
        let client = SobreContractClient::new(&env, &contract_id);
        client.init(&admin, &payment_token, &vec![&env, 50u32, 30u32, 20u32]);
        Self {
            env,
            contract_id,
            admin,
            payment_token,
        }
    }

    fn client(&self) -> SobreContractClient<'_> {
        SobreContractClient::new(&self.env, &self.contract_id)
    }

    fn token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.payment_token)
    }

    /// Mint tokens into an account for tests that need deposit-able balance.
    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.payment_token).mint(to, &amount);
    }
}

#[test]
fn init_seeds_members_with_admin() {
    let f = Fixture::new();
    let state = f.client().get_state();

    assert_eq!(state.admin, f.admin);
    assert_eq!(state.payment_token, f.payment_token);
    assert_eq!(state.percents, vec![&f.env, 50u32, 30u32, 20u32]);
    assert_eq!(state.members.len(), 1);
    assert_eq!(state.members.get(0).unwrap(), f.admin);
    assert_eq!(state.balances.len(), 3);
    assert_eq!(state.balances.get(0).unwrap(), 0);
    assert_eq!(state.balances.get(1).unwrap(), 0);
    assert_eq!(state.balances.get(2).unwrap(), 0);
}

#[test]
fn add_member_appends() {
    let f = Fixture::new();
    let member = Address::generate(&f.env);

    f.client().add_member(&member);

    let state = f.client().get_state();
    assert_eq!(state.members.len(), 2);
    assert_eq!(state.members.get(0).unwrap(), f.admin);
    assert_eq!(state.members.get(1).unwrap(), member);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn add_member_rejects_duplicate() {
    let f = Fixture::new();
    f.client().add_member(&f.admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn add_member_rejects_when_at_max() {
    let f = Fixture::new();
    let m1 = Address::generate(&f.env);
    f.client().add_member(&m1);
    let m2 = Address::generate(&f.env);
    f.client().add_member(&m2);
}

#[test]
fn set_envelopes_updates_split() {
    let f = Fixture::new();
    let updated = vec![&f.env, 60u32, 25u32, 15u32];

    f.client().set_envelopes(&updated);

    assert_eq!(f.client().get_state().percents, updated);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn set_envelopes_rejects_bad_sum() {
    let f = Fixture::new();
    f.client().set_envelopes(&vec![&f.env, 50u32, 30u32, 30u32]);
}

// ─── Phase 3: deposit ─────────────────────────────────────────────────────

#[test]
fn deposit_splits_per_percents() {
    let f = Fixture::new();
    f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);

    f.client().deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));

    // env.events().all() returns events from the LAST invocation, so we
    // assert event emission immediately after deposit, before any view call.
    let sobre_events = f.env.events().all().filter_by_contract(&f.contract_id);
    assert_eq!(sobre_events.events().len(), 1);

    let state = f.client().get_state();
    // 50/30/20 of 100 tokens.
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 30 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 20 * STROOPS_PER_TOKEN);

    // Token actually moved: alice's balance went down, contract's went up.
    assert_eq!(f.token().balance(&f.admin), 900 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&f.contract_id), 100 * STROOPS_PER_TOKEN);
}

#[test]
fn deposit_accumulates_across_calls() {
    let f = Fixture::new();
    f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);

    f.client().deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));
    f.client().deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 100 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 60 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 40 * STROOPS_PER_TOKEN);
}

#[test]
fn deposit_assigns_rounding_remainder_to_savings() {
    let f = Fixture::new();
    f.mint(&f.admin, 1_000);

    // 101 stroops 50/30/20 = 50 + 30 + 21 (savings absorbs the leftover stroop).
    f.client().deposit(&f.admin, &101);

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50);
    assert_eq!(state.balances.get(1).unwrap(), 30);
    assert_eq!(state.balances.get(2).unwrap(), 21);

    // No dust loss: sum equals deposit.
    let sum = state.balances.get(0).unwrap()
        + state.balances.get(1).unwrap()
        + state.balances.get(2).unwrap();
    assert_eq!(sum, 101);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn deposit_rejects_zero() {
    let f = Fixture::new();
    f.client().deposit(&f.admin, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn deposit_rejects_negative() {
    let f = Fixture::new();
    f.client().deposit(&f.admin, &-100);
}
