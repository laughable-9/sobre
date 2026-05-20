#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, vec, Env};

/// All Phase 2 tests start from "initialized wallet with admin + default
/// 50/30/20 split." Re-creating the client is cheap — it just wraps the
/// stored `contract_id` — so each test calls `f.client()` per invocation
/// rather than holding a client field (which would force a self-referential
/// struct and lifetime headaches).
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
        let contract_id = env.register(SobreContract, ());
        let admin = Address::generate(&env);
        let payment_token = Address::generate(&env);
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
