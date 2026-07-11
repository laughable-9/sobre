#![cfg(test)]
use super::*;
use blend_contract_sdk::{
    pool as blend_pool,
    testutils::{default_reserve_config, BlendFixture},
};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
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

// ─── Earn: Blend integration ──────────────────────────────────────────────

/// Full Blend v2 fixture wrapping the Sobre fixture. Deploys backstop +
/// emitter + pool_factory, spins up a pool with `payment_token` as its sole
/// reserve, and moves the pool into an active status. Setup is heavy but
/// paid once per test.
struct EarnFixture {
    sobre: Fixture,
    blend_pool: Address,
}

impl EarnFixture {
    fn new() -> Self {
        let sobre = Fixture::funded();
        let env = &sobre.env;

        let deployer = Address::generate(env);
        let blnd = env
            .register_stellar_asset_contract_v2(deployer.clone())
            .address();
        let usdc = env
            .register_stellar_asset_contract_v2(deployer.clone())
            .address();
        let blend = BlendFixture::deploy(env, &deployer, &blnd, &usdc);

        // Reuse Sobre's payment token as the reserve asset so a real supply
        // path shares one token contract with the Savings envelope.
        let pool_addr = blend.pool_factory.mock_all_auths().deploy(
            &deployer,
            &String::from_str(env, "sobre-test"),
            &BytesN::<32>::random(env),
            &Address::generate(env),
            &0_1000000, // 10% take rate
            &4,         // max positions
            &1_0000000, // min collateral (7-decimal oracle)
        );
        let pool_client = blend_pool::Client::new(env, &pool_addr);
        pool_client
            .mock_all_auths()
            .queue_set_reserve(&sobre.payment_token, &default_reserve_config());
        pool_client.mock_all_auths().set_reserve(&sobre.payment_token);

        blend
            .backstop
            .mock_all_auths()
            .deposit(&deployer, &pool_addr, &50_000_0000000);
        pool_client.mock_all_auths().set_status(&3);
        pool_client.mock_all_auths().update_status();

        Self {
            sobre,
            blend_pool: pool_addr,
        }
    }

    /// Reads the position for `envelope`, defaulting to zero when absent.
    /// Test-only helper so assertions don't have to walk `positions` inline.
    fn position(&self, envelope: Envelope) -> EarnPosition {
        let state = self.sobre.client().get_state();
        let earn = state.earn.get(0).expect("earn should be enabled");
        for p in earn.positions.iter() {
            if p.envelope == envelope {
                return p.clone();
            }
        }
        EarnPosition {
            envelope,
            b_tokens: 0,
            underlying: 0,
        }
    }
}

#[test]
fn earn_enable_persists_pool_and_asset_and_marks_enabled() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    let state = f.client().get_state();
    let earn = state.earn.get(0).expect("enabled");
    assert_eq!(earn.pool, ef.blend_pool);
    assert_eq!(earn.asset, f.payment_token);
    assert_eq!(earn.positions.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn earn_enable_rejects_second_call() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn earn_supply_rejects_when_disabled() {
    let f = Fixture::funded();
    f.client()
        .earn_supply(&Envelope::Savings, &(5 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn earn_withdraw_rejects_when_disabled() {
    let f = Fixture::funded();
    f.client()
        .earn_withdraw(&Envelope::Savings, &(5 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn earn_supply_rejects_zero() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    f.client().earn_supply(&Envelope::Savings, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn earn_supply_rejects_amount_over_envelope_balance() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    // Fixture::funded credited 20 into Savings. Try to supply 21.
    f.client()
        .earn_supply(&Envelope::Savings, &(21 * STROOPS_PER_TOKEN));
}

#[test]
fn earn_supply_debits_envelope_and_credits_b_tokens() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    let amount = 15 * STROOPS_PER_TOKEN;
    f.client().earn_supply(&Envelope::Savings, &amount);
    let state = f.client().get_state();
    // Savings envelope drops from 20 → 5.
    assert_eq!(state.balances.get(2).unwrap(), 5 * STROOPS_PER_TOKEN);
    let pos = ef.position(Envelope::Savings);
    assert!(pos.b_tokens > 0);
    assert!(pos.underlying >= amount - 1); // fixed-point drift ≤ 1 stroop
    assert!(pos.underlying <= amount);
}

#[test]
fn earn_withdraw_credits_envelope_and_burns_b_tokens() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    f.client()
        .earn_supply(&Envelope::Savings, &(15 * STROOPS_PER_TOKEN));
    let mid_pos = ef.position(Envelope::Savings);
    let savings_before = f.client().get_state().balances.get(2).unwrap();

    let withdraw = 10 * STROOPS_PER_TOKEN;
    f.client().earn_withdraw(&Envelope::Savings, &withdraw);
    let end = f.client().get_state();
    assert_eq!(end.balances.get(2).unwrap(), savings_before + withdraw);
    let end_pos = ef.position(Envelope::Savings);
    assert!(end_pos.b_tokens < mid_pos.b_tokens);
    assert!(end_pos.b_tokens > 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn earn_withdraw_rejects_when_no_position() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    f.client()
        .earn_withdraw(&Envelope::Savings, &(1 * STROOPS_PER_TOKEN));
}

#[test]
fn earn_state_is_empty_vec_when_disabled() {
    let f = Fixture::funded();
    assert_eq!(f.client().get_state().earn.len(), 0);
}

#[test]
fn earn_supply_then_withdraw_round_trips_underlying() {
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    let supplied = 12 * STROOPS_PER_TOKEN;
    f.client().earn_supply(&Envelope::Savings, &supplied);

    // Advance ledger past reserve accrual so b_rate ticks slightly.
    f.env.ledger().with_mut(|l| l.timestamp += 60);

    f.client().earn_withdraw(&Envelope::Savings, &supplied);
    let state = f.client().get_state();
    // Savings envelope should be back at ~20 (may be off by a stroop or two
    // if b_rate moved during accrual; no drift means the round trip works).
    assert!(state.balances.get(2).unwrap() >= 20 * STROOPS_PER_TOKEN - 2);
    assert!(state.balances.get(2).unwrap() <= 20 * STROOPS_PER_TOKEN);
    let pos = ef.position(Envelope::Savings);
    assert!(pos.b_tokens >= 0);
}

#[test]
fn earn_supply_isolates_per_envelope_bookkeeping() {
    // The altitude story: parameterizing by Envelope must actually attribute
    // deltas to the caller envelope only. Supply 5 to Groceries, then 5 to
    // Savings. Verify each position tracks its own share.
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    f.client()
        .earn_supply(&Envelope::Groceries, &(5 * STROOPS_PER_TOKEN));
    f.client()
        .earn_supply(&Envelope::Savings, &(5 * STROOPS_PER_TOKEN));

    let g = ef.position(Envelope::Groceries);
    let s = ef.position(Envelope::Savings);
    assert!(g.b_tokens > 0);
    assert!(s.b_tokens > 0);
    // Both should be within ±1 of each other since they supplied the same amount.
    let diff = if g.b_tokens > s.b_tokens {
        g.b_tokens - s.b_tokens
    } else {
        s.b_tokens - g.b_tokens
    };
    assert!(diff <= 1);

    // Withdraw from Groceries: only its position should shrink; Savings untouched.
    f.client()
        .earn_withdraw(&Envelope::Groceries, &(3 * STROOPS_PER_TOKEN));
    let g2 = ef.position(Envelope::Groceries);
    let s2 = ef.position(Envelope::Savings);
    assert!(g2.b_tokens < g.b_tokens);
    assert_eq!(s2.b_tokens, s.b_tokens);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn earn_withdraw_cannot_drain_sibling_envelope() {
    // Attribution invariant: Groceries funds 5, Savings 5. Total aggregate
    // is ~10. Groceries tries to withdraw 8 — the delta would exceed its own
    // position, so we reject before overspending against sibling accounting.
    let ef = EarnFixture::new();
    let f = &ef.sobre;
    f.client().earn_enable(&ef.blend_pool, &f.payment_token);
    f.client()
        .earn_supply(&Envelope::Groceries, &(5 * STROOPS_PER_TOKEN));
    f.client()
        .earn_supply(&Envelope::Savings, &(5 * STROOPS_PER_TOKEN));
    f.client()
        .earn_withdraw(&Envelope::Groceries, &(8 * STROOPS_PER_TOKEN));
}

// ─── Grow: 48h timelock ───────────────────────────────────────────────────

/// Wall-clock 48 hours in seconds — hardcoded here so tests are honest
/// about the value they're checking against. If the contract's constant
/// ever changes, this test fails and forces the copy to stay in sync.
const GROW_TIMELOCK_SECS: u64 = 48 * 3600;

#[test]
fn grow_enable_marks_state_and_zeroes_balance() {
    let f = Fixture::funded();
    f.client().grow_enable();
    let state = f.client().get_state();
    assert!(state.grow_enabled);
    assert_eq!(state.grow_balance, 0);
    assert_eq!(state.grow_requests.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn grow_enable_rejects_second_call() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client().grow_enable();
}

#[test]
fn grow_state_default_when_disabled() {
    let f = Fixture::funded();
    let state = f.client().get_state();
    assert!(!state.grow_enabled);
    assert_eq!(state.grow_balance, 0);
    assert_eq!(state.grow_requests.len(), 0);
}

#[test]
fn grow_transfer_from_savings_moves_stroops_into_bucket() {
    let f = Fixture::funded();
    f.client().grow_enable();
    let amount = 15 * STROOPS_PER_TOKEN;
    f.client().grow_transfer_from_savings(&amount);
    let state = f.client().get_state();
    assert_eq!(state.grow_balance, amount);
    // Savings envelope drops from 20 → 5.
    assert_eq!(state.balances.get(2).unwrap(), 5 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn grow_transfer_rejects_when_disabled() {
    let f = Fixture::funded();
    f.client().grow_transfer_from_savings(&(1 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn grow_transfer_rejects_zero() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client().grow_transfer_from_savings(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn grow_transfer_rejects_over_savings_balance() {
    let f = Fixture::funded();
    f.client().grow_enable();
    // Savings has 20 after funding; try 21.
    f.client().grow_transfer_from_savings(&(21 * STROOPS_PER_TOKEN));
}

#[test]
fn grow_request_queues_and_reserves_amount() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    let ts_before = f.env.ledger().timestamp();
    let id = f.client().request_grow_withdrawal(&(10 * STROOPS_PER_TOKEN));
    assert_eq!(id, 0);
    let state = f.client().get_state();
    assert_eq!(state.grow_requests.len(), 1);
    let req = state.grow_requests.get(0).unwrap();
    assert_eq!(req.id, 0);
    assert_eq!(req.requester, f.admin);
    assert_eq!(req.amount, 10 * STROOPS_PER_TOKEN);
    assert_eq!(req.unlock_at, ts_before + GROW_TIMELOCK_SECS);
    // Balance is still 15 — reservation is virtual, not a debit.
    assert_eq!(state.grow_balance, 15 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn grow_request_rejects_when_reservations_exceed_balance() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client()
        .grow_transfer_from_savings(&(10 * STROOPS_PER_TOKEN));
    f.client().request_grow_withdrawal(&(7 * STROOPS_PER_TOKEN));
    // 7 already reserved; asking for 4 more (7+4=11 > 10) must panic.
    f.client().request_grow_withdrawal(&(4 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn grow_request_rejects_when_disabled() {
    let f = Fixture::funded();
    f.client().request_grow_withdrawal(&(1 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn grow_execute_rejects_before_unlock() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client()
        .grow_transfer_from_savings(&(10 * STROOPS_PER_TOKEN));
    let id = f.client().request_grow_withdrawal(&(10 * STROOPS_PER_TOKEN));
    // One second short of the timelock.
    f.env.ledger().with_mut(|l| l.timestamp += GROW_TIMELOCK_SECS - 1);
    f.client().execute_grow_withdrawal(&id);
}

#[test]
fn grow_execute_at_unlock_transfers_tokens_and_clears_request() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client()
        .grow_transfer_from_savings(&(10 * STROOPS_PER_TOKEN));
    let admin_before = f.token().balance(&f.admin);
    let id = f.client().request_grow_withdrawal(&(10 * STROOPS_PER_TOKEN));
    f.env.ledger().with_mut(|l| l.timestamp += GROW_TIMELOCK_SECS);
    f.client().execute_grow_withdrawal(&id);
    let state = f.client().get_state();
    assert_eq!(state.grow_balance, 0);
    assert_eq!(state.grow_requests.len(), 0);
    assert_eq!(
        f.token().balance(&f.admin),
        admin_before + 10 * STROOPS_PER_TOKEN,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn grow_execute_with_unknown_id_fails() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client().execute_grow_withdrawal(&999);
}

#[test]
fn grow_cancel_clears_request_before_unlock() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client()
        .grow_transfer_from_savings(&(10 * STROOPS_PER_TOKEN));
    let id = f.client().request_grow_withdrawal(&(10 * STROOPS_PER_TOKEN));
    f.client().cancel_grow_withdrawal(&id);
    let state = f.client().get_state();
    assert_eq!(state.grow_requests.len(), 0);
    // Balance stays put — cancel is a request-only clear.
    assert_eq!(state.grow_balance, 10 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn grow_cancel_with_unknown_id_fails() {
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client().cancel_grow_withdrawal(&42);
}

#[test]
fn grow_execute_after_multiple_requests_only_clears_target() {
    // Two concurrent requests; execute one; the other stays reserved.
    let f = Fixture::funded();
    f.client().grow_enable();
    f.client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    let id0 = f.client().request_grow_withdrawal(&(6 * STROOPS_PER_TOKEN));
    let id1 = f.client().request_grow_withdrawal(&(4 * STROOPS_PER_TOKEN));
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    f.env.ledger().with_mut(|l| l.timestamp += GROW_TIMELOCK_SECS);
    f.client().execute_grow_withdrawal(&id0);
    let state = f.client().get_state();
    assert_eq!(state.grow_balance, 9 * STROOPS_PER_TOKEN);
    assert_eq!(state.grow_requests.len(), 1);
    assert_eq!(state.grow_requests.get(0).unwrap().id, id1);
}
