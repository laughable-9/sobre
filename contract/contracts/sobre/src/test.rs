#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Bytes, BytesN, Env, String,
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

    /// Distinct byte pattern from `create_invite` so member + sub-account
    /// invites can coexist in storage when both are minted in one test.
    fn create_subaccount_invite_token(&self, marker: u8) -> BytesN<32> {
        let token = BytesN::from_array(&self.env, &[marker; 32]);
        let hash: BytesN<32> = self.env.crypto().sha256(&Bytes::from(token.clone())).into();
        let expires_at = self.env.ledger().sequence() + 1000;
        self.client().create_subaccount_invite(&hash, &expires_at);
        token
    }

    fn funded_with_subaccount() -> (Self, Address) {
        let f = Self::funded();
        let kid = Address::generate(&f.env);
        let token = f.create_subaccount_invite_token(0x21);
        f.client().join_as_subaccount(&kid, &token);
        (f, kid)
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

// ─── Sub-account tests ─────────────────────────────────────────────────────

#[test]
fn join_as_subaccount_registers_with_zero_balance_unlocked() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let state = f.client().get_state();
    assert_eq!(state.subaccounts.len(), 1);
    let sub = state.subaccounts.get(0).unwrap();
    assert_eq!(sub.address, kid);
    assert_eq!(sub.balance, 0);
    assert!(!sub.locked);
    // Sub-accounts don't bleed into the member list.
    assert_eq!(state.members.len(), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn join_as_subaccount_rejects_existing_member() {
    let (f, member) = Fixture::funded_with_member();
    let token = f.create_subaccount_invite_token(0x21);
    f.client().join_as_subaccount(&member, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn join_as_subaccount_rejects_duplicate() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let token = f.create_subaccount_invite_token(0x22);
    f.client().join_as_subaccount(&kid, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn join_as_subaccount_rejects_member_invite_token() {
    let f = Fixture::new();
    // Mint a *member* invite then try to redeem via the sub-account path.
    let member_token = f.create_invite();
    let kid = Address::generate(&f.env);
    f.client().join_as_subaccount(&kid, &member_token);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn join_as_subaccount_rejects_when_at_max() {
    let f = Fixture::funded();
    for i in 0..4u8 {
        let kid = Address::generate(&f.env);
        let token = f.create_subaccount_invite_token(0x30 + i);
        f.client().join_as_subaccount(&kid, &token);
    }
    let overflow = Address::generate(&f.env);
    let token = f.create_subaccount_invite_token(0x40);
    f.client().join_as_subaccount(&overflow, &token);
}

#[test]
fn fund_subaccount_debits_envelope_and_credits_sub() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Tuition,
        &kid,
        &(8 * STROOPS_PER_TOKEN),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(1).unwrap(), 22 * STROOPS_PER_TOKEN);
    assert_eq!(state.subaccounts.get(0).unwrap().balance, 8 * STROOPS_PER_TOKEN);
    // No token leaves the contract — fund is internal ledger only.
    assert_eq!(f.token().balance(&kid), 0);
}

#[test]
fn fund_subaccount_accumulates_across_envelopes() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Groceries,
        &kid,
        &(3 * STROOPS_PER_TOKEN),
    );
    f.client().fund_subaccount(
        &Envelope::Tuition,
        &kid,
        &(4 * STROOPS_PER_TOKEN),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 47 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 26 * STROOPS_PER_TOKEN);
    assert_eq!(state.subaccounts.get(0).unwrap().balance, 7 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn fund_subaccount_rejects_unknown_recipient() {
    let f = Fixture::funded();
    let nobody = Address::generate(&f.env);
    f.client().fund_subaccount(
        &Envelope::Groceries,
        &nobody,
        &STROOPS_PER_TOKEN,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn fund_subaccount_rejects_envelope_underflow() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Savings,
        &kid,
        &(21 * STROOPS_PER_TOKEN), // Savings holds 20
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn fund_subaccount_rejects_zero() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(&Envelope::Groceries, &kid, &0);
}

#[test]
fn spend_from_subaccount_transfers_tokens_to_caller() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Groceries,
        &kid,
        &(10 * STROOPS_PER_TOKEN),
    );
    let kid_before = f.token().balance(&kid);
    f.client().spend_from_subaccount(
        &kid,
        &(4 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "school baon"),
    );
    let state = f.client().get_state();
    assert_eq!(state.subaccounts.get(0).unwrap().balance, 6 * STROOPS_PER_TOKEN);
    assert_eq!(
        f.token().balance(&kid),
        kid_before + 4 * STROOPS_PER_TOKEN
    );
    // Envelope balances are untouched by a sub-account spend.
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn spend_from_subaccount_rejects_when_locked() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Groceries,
        &kid,
        &(10 * STROOPS_PER_TOKEN),
    );
    f.client().lock_subaccount(&kid);
    f.client().spend_from_subaccount(
        &kid,
        &STROOPS_PER_TOKEN,
        &String::from_str(&f.env, "denied"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn spend_from_subaccount_rejects_insufficient_balance() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().spend_from_subaccount(
        &kid,
        &STROOPS_PER_TOKEN,
        &String::from_str(&f.env, "broke"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn spend_from_subaccount_rejects_non_subaccount() {
    let f = Fixture::funded();
    let stranger = Address::generate(&f.env);
    f.client().spend_from_subaccount(
        &stranger,
        &STROOPS_PER_TOKEN,
        &String::from_str(&f.env, "outsider"),
    );
}

#[test]
fn lock_then_unlock_restores_spend() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Groceries,
        &kid,
        &(5 * STROOPS_PER_TOKEN),
    );
    f.client().lock_subaccount(&kid);
    assert!(f.client().get_state().subaccounts.get(0).unwrap().locked);
    f.client().unlock_subaccount(&kid);
    assert!(!f.client().get_state().subaccounts.get(0).unwrap().locked);
    f.client().spend_from_subaccount(
        &kid,
        &(2 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "ok now"),
    );
    assert_eq!(
        f.client().get_state().subaccounts.get(0).unwrap().balance,
        3 * STROOPS_PER_TOKEN,
    );
}

#[test]
fn lock_is_idempotent() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().lock_subaccount(&kid);
    f.client().lock_subaccount(&kid); // no panic
    assert!(f.client().get_state().subaccounts.get(0).unwrap().locked);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn lock_subaccount_rejects_unknown_address() {
    let f = Fixture::funded();
    let nobody = Address::generate(&f.env);
    f.client().lock_subaccount(&nobody);
}

#[test]
fn close_wallet_sweeps_subaccount_balances_to_admin() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client().fund_subaccount(
        &Envelope::Groceries,
        &kid,
        &(10 * STROOPS_PER_TOKEN),
    );
    let admin_before = f.token().balance(&f.admin);
    f.client().close_wallet();
    let state = f.client().get_state();
    for b in state.balances.iter() {
        assert_eq!(b, 0);
    }
    assert_eq!(state.subaccounts.get(0).unwrap().balance, 0);
    assert_eq!(f.token().balance(&f.contract_id), 0);
    // Admin recovers all 100 (envelopes) — the 10 lifted into the sub is
    // included because it was deducted from Groceries when funding.
    assert_eq!(
        f.token().balance(&f.admin),
        admin_before + 100 * STROOPS_PER_TOKEN,
    );
}
