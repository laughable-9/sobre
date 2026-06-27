#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Bytes, BytesN, Env, String,
};

const STROOPS_PER_TOKEN: i128 = 10_000_000;

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
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let payment_token = token_contract.address();
        let admin = Address::generate(&env);
        let factory = Address::generate(&env);
        let contract_id = env.register(
            SobreContract,
            (admin.clone(), payment_token.clone(), factory),
        );
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

    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.payment_token).mint(to, &amount);
    }

    fn funded() -> Self {
        let f = Self::new();
        f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);
        f.client().deposit_with_split(
            &f.admin,
            &(50 * STROOPS_PER_TOKEN),
            &(30 * STROOPS_PER_TOKEN),
            &(20 * STROOPS_PER_TOKEN),
        );
        f
    }

    fn funded_with_member() -> (Self, Address) {
        let f = Self::funded();
        let member = Address::generate(&f.env);
        let token = f.create_invite();
        f.client().join_wallet(&member, &token);
        (f, member)
    }

    fn create_invite(&self) -> BytesN<32> {
        let token = BytesN::from_array(&self.env, &[7u8; 32]);
        let hash: BytesN<32> = self.env.crypto().sha256(&Bytes::from(token.clone())).into();
        let expires_at = self.env.ledger().sequence() + 1000;
        self.client().create_invite(&hash, &expires_at);
        token
    }
}

#[test]
fn init_seeds_admin_member_and_zero_balances() {
    let f = Fixture::new();
    let state = f.client().get_state();
    assert_eq!(state.admin, f.admin);
    assert_eq!(state.payment_token, f.payment_token);
    assert_eq!(state.members.len(), 1);
    assert_eq!(state.members.get(0).unwrap().address, f.admin);
    assert_eq!(state.balances.len(), 3);
    for b in state.balances.iter() {
        assert_eq!(b, 0);
    }
}

#[test]
fn join_wallet_appends_member_address() {
    let f = Fixture::new();
    let maria = Address::generate(&f.env);
    let token = f.create_invite();
    f.client().join_wallet(&maria, &token);
    assert_eq!(f.client().get_state().members.len(), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn join_wallet_rejects_duplicate() {
    let f = Fixture::new();
    let token = f.create_invite();
    f.client().join_wallet(&f.admin, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn join_wallet_rejects_when_at_max() {
    let f = Fixture::new();
    let m1 = Address::generate(&f.env);
    let t1 = f.create_invite();
    f.client().join_wallet(&m1, &t1);
    let t2_plain = BytesN::from_array(&f.env, &[9u8; 32]);
    let t2_hash: BytesN<32> = f.env.crypto().sha256(&Bytes::from(t2_plain.clone())).into();
    f.client()
        .create_invite(&t2_hash, &(f.env.ledger().sequence() + 1000));
    let m2 = Address::generate(&f.env);
    f.client().join_wallet(&m2, &t2_plain);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn join_wallet_rejects_unknown_token() {
    let f = Fixture::new();
    let bogus = BytesN::from_array(&f.env, &[0xAAu8; 32]);
    let maria = Address::generate(&f.env);
    f.client().join_wallet(&maria, &bogus);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn join_wallet_rejects_expired_token() {
    let f = Fixture::new();
    let token = f.create_invite();
    f.env.ledger().with_mut(|l| l.sequence_number += 2000);
    let maria = Address::generate(&f.env);
    f.client().join_wallet(&maria, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn join_wallet_rejects_replayed_token() {
    let f = Fixture::new();
    let token = f.create_invite();
    let maria = Address::generate(&f.env);
    f.client().join_wallet(&maria, &token);
    let pedro = Address::generate(&f.env);
    f.client().join_wallet(&pedro, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn create_invite_rejects_past_expiry() {
    let f = Fixture::new();
    let token = BytesN::from_array(&f.env, &[3u8; 32]);
    let hash: BytesN<32> = f.env.crypto().sha256(&Bytes::from(token)).into();
    f.client().create_invite(&hash, &f.env.ledger().sequence());
}

#[test]
fn remove_member_drops_member_and_emits_event() {
    let (f, member) = Fixture::funded_with_member();
    f.client().remove_member(&member);
    let state = f.client().get_state();
    assert_eq!(state.members.len(), 1);
    assert_eq!(state.members.get(0).unwrap().address, f.admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn remove_member_rejects_removing_admin() {
    let f = Fixture::new();
    f.client().remove_member(&f.admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn remove_member_rejects_unknown_address() {
    let f = Fixture::new();
    let nobody = Address::generate(&f.env);
    f.client().remove_member(&nobody);
}

#[test]
fn close_wallet_sweeps_all_envelopes_to_admin() {
    let f = Fixture::funded();
    let admin_token_before = f.token().balance(&f.admin);
    f.client().close_wallet();
    let state = f.client().get_state();
    for b in state.balances.iter() {
        assert_eq!(b, 0);
    }
    assert_eq!(f.token().balance(&f.contract_id), 0);
    assert_eq!(
        f.token().balance(&f.admin),
        admin_token_before + 100 * STROOPS_PER_TOKEN,
    );
}

#[test]
fn close_wallet_with_empty_balances_no_ops_cleanly() {
    let f = Fixture::new();
    f.client().close_wallet();
    assert_eq!(f.client().get_state().balances.get(0).unwrap(), 0);
}

#[test]
fn deposit_with_split_credits_each_envelope_independently() {
    let f = Fixture::new();
    f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);
    f.client().deposit_with_split(
        &f.admin,
        &(40 * STROOPS_PER_TOKEN),
        &(35 * STROOPS_PER_TOKEN),
        &(25 * STROOPS_PER_TOKEN),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 35 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 25 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&f.admin), 900 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&f.contract_id), 100 * STROOPS_PER_TOKEN);
}

#[test]
fn deposit_with_split_accumulates_across_calls() {
    let f = Fixture::funded();
    f.client().deposit_with_split(
        &f.admin,
        &(10 * STROOPS_PER_TOKEN),
        &(20 * STROOPS_PER_TOKEN),
        &(30 * STROOPS_PER_TOKEN),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 60 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 50 * STROOPS_PER_TOKEN);
}

#[test]
fn deposit_with_split_allows_zero_for_one_envelope() {
    let f = Fixture::new();
    f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);
    f.client()
        .deposit_with_split(&f.admin, &(50 * STROOPS_PER_TOKEN), &0, &(50 * STROOPS_PER_TOKEN));
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 0);
    assert_eq!(state.balances.get(2).unwrap(), 50 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn deposit_with_split_rejects_all_zero() {
    let f = Fixture::new();
    f.client().deposit_with_split(&f.admin, &0, &0, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn deposit_with_split_rejects_negative_envelope() {
    let f = Fixture::new();
    f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);
    f.client()
        .deposit_with_split(&f.admin, &(50 * STROOPS_PER_TOKEN), &(-1), &(50 * STROOPS_PER_TOKEN));
}

#[test]
fn spend_deducts_from_envelope_and_returns_tokens() {
    let (f, member) = Fixture::funded_with_member();
    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "groceries"),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&member), 10 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn spend_rejects_non_member() {
    let f = Fixture::funded();
    let stranger = Address::generate(&f.env);
    f.client().spend(
        &stranger,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "outsider"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn spend_rejects_insufficient_balance() {
    let f = Fixture::funded();
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(60 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "too much"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn spend_rejects_zero() {
    let f = Fixture::funded();
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &0,
        &String::from_str(&f.env, ""),
    );
}

#[test]
fn spend_works_across_envelopes_independently() {
    let f = Fixture::funded();
    f.client().spend(
        &f.admin,
        &Envelope::Tuition,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "school fee"),
    );
    f.client().spend(
        &f.admin,
        &Envelope::Savings,
        &(2 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "savings draw"),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 25 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 18 * STROOPS_PER_TOKEN);
}

#[test]
fn spend_on_behalf_credits_member_wallet() {
    let (f, member) = Fixture::funded_with_member();
    let member_before = f.token().balance(&member);
    f.client().spend_on_behalf(
        &member,
        &Envelope::Tuition,
        &(7 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "approved tuition"),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(1).unwrap(), 23 * STROOPS_PER_TOKEN);
    assert_eq!(
        f.token().balance(&member),
        member_before + 7 * STROOPS_PER_TOKEN
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn spend_on_behalf_rejects_non_member() {
    let f = Fixture::funded();
    let stranger = Address::generate(&f.env);
    f.client().spend_on_behalf(
        &stranger,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "outsider"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn spend_on_behalf_rejects_insufficient_balance() {
    let (f, member) = Fixture::funded_with_member();
    f.client().spend_on_behalf(
        &member,
        &Envelope::Groceries,
        &(60 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "too much"),
    );
}
