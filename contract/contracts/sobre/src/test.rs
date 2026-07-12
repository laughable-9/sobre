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

// USDC's SEP-41 SAC uses 7-decimal precision. Keep this in sync with the
// hardcoded constant in web/src/lib/config.ts so cross-layer math lines up.
const STROOPS_PER_TOKEN: i128 = 10_000_000;

/// Test-only MockSoroswap router. Deterministic USDC↔XLM swap at a hardcoded
/// rate that mirrors mainnet-ish pricing so per-envelope accounting math is
/// easy to eyeball in test assertions. Not a real AMM — no reserves, no
/// slippage curve, no constant-product. Pre-funded with enough of both
/// tokens to cover the tests' swap volume.
///
/// Rate convention (see `xlm_per_usdc()` / `usdc_per_xlm()`):
///   1 USDC = 8 XLM (or 1 XLM = 0.125 USDC)
///
/// This is the ratio the mock uses regardless of Soroswap-style "amount in"
/// / "amount out" direction — all four view + swap methods use the same
/// deterministic conversion.
mod mock_soroswap {
    use soroban_sdk::{
        contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
    };

    const RATE_MULT: i128 = 8;

    /// USDC in → XLM out: multiply by 8.
    fn usdc_to_xlm(amount_usdc: i128) -> i128 {
        amount_usdc * RATE_MULT
    }
    /// XLM in → USDC out: divide by 8.
    fn xlm_to_usdc(amount_xlm: i128) -> i128 {
        amount_xlm / RATE_MULT
    }

    #[contracttype]
    pub enum DataKey {
        UsdcAddr,
        XlmAddr,
    }

    #[contract]
    pub struct MockSoroswap;

    #[contractimpl]
    impl MockSoroswap {
        pub fn init(env: Env, usdc: Address, xlm: Address) {
            env.storage().instance().set(&DataKey::UsdcAddr, &usdc);
            env.storage().instance().set(&DataKey::XlmAddr, &xlm);
        }

        pub fn router_get_amounts_out(env: Env, amount_in: i128, path: Vec<Address>) -> Vec<i128> {
            let usdc: Address = env.storage().instance().get(&DataKey::UsdcAddr).unwrap();
            let token_in = path.get(0).unwrap();
            let amount_out = if token_in == usdc {
                usdc_to_xlm(amount_in)
            } else {
                xlm_to_usdc(amount_in)
            };
            let mut amounts = Vec::new(&env);
            amounts.push_back(amount_in);
            amounts.push_back(amount_out);
            amounts
        }

        pub fn router_get_amounts_in(env: Env, amount_out: i128, path: Vec<Address>) -> Vec<i128> {
            let usdc: Address = env.storage().instance().get(&DataKey::UsdcAddr).unwrap();
            let token_out = path.get(path.len() - 1).unwrap();
            let amount_in = if token_out == usdc {
                // Selling XLM to get USDC: XLM in = USDC out * 8
                amount_out * RATE_MULT
            } else {
                // Selling USDC to get XLM: USDC in = XLM out / 8
                amount_out / RATE_MULT
            };
            let mut amounts = Vec::new(&env);
            amounts.push_back(amount_in);
            amounts.push_back(amount_out);
            amounts
        }

        pub fn swap_exact_tokens_for_tokens(
            env: Env,
            amount_in: i128,
            amount_out_min: i128,
            path: Vec<Address>,
            to: Address,
            _deadline: u64,
        ) -> Vec<i128> {
            let usdc: Address = env.storage().instance().get(&DataKey::UsdcAddr).unwrap();
            let token_in = path.get(0).unwrap();
            let token_out = path.get(path.len() - 1).unwrap();
            let amount_out = if token_in == usdc {
                usdc_to_xlm(amount_in)
            } else {
                xlm_to_usdc(amount_in)
            };
            if amount_out < amount_out_min {
                panic!("mock soroswap: slippage");
            }
            // Pull input from `to`, deliver output to `to`. Mock's contract
            // address holds a pre-funded reserve of both tokens (set up in
            // GrowFixture::build).
            let self_addr = env.current_contract_address();
            token::Client::new(&env, &token_in).transfer(&to, &self_addr, &amount_in);
            token::Client::new(&env, &token_out).transfer(&self_addr, &to, &amount_out);
            env.events().publish(
                (symbol_short!("swap"),),
                (token_in, token_out, amount_in, amount_out),
            );
            let mut amounts = Vec::new(&env);
            amounts.push_back(amount_in);
            amounts.push_back(amount_out);
            amounts
        }

        pub fn swap_tokens_for_exact_tokens(
            env: Env,
            amount_out: i128,
            amount_in_max: i128,
            path: Vec<Address>,
            to: Address,
            _deadline: u64,
        ) -> Vec<i128> {
            let usdc: Address = env.storage().instance().get(&DataKey::UsdcAddr).unwrap();
            let token_in = path.get(0).unwrap();
            let token_out = path.get(path.len() - 1).unwrap();
            let amount_in = if token_out == usdc {
                amount_out * RATE_MULT
            } else {
                amount_out / RATE_MULT
            };
            if amount_in > amount_in_max {
                panic!("mock soroswap: input exceeds max");
            }
            let self_addr = env.current_contract_address();
            token::Client::new(&env, &token_in).transfer(&to, &self_addr, &amount_in);
            token::Client::new(&env, &token_out).transfer(&self_addr, &to, &amount_out);
            let mut amounts = Vec::new(&env);
            amounts.push_back(amount_in);
            amounts.push_back(amount_out);
            amounts
        }
    }
}

struct Fixture {
    env: Env,
    contract_id: Address,
    admin: Address,
    payment_token: Address,
    payment_token_admin: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
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
            payment_token_admin: token_admin,
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

// ─── Non-Earn / non-Grow tests (unchanged semantics) ──────────────────────

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
    f.mint(&f.admin, 100 * STROOPS_PER_TOKEN);
    f.client().deposit_with_split(
        &f.admin,
        &(30 * STROOPS_PER_TOKEN),
        &0,
        &(10 * STROOPS_PER_TOKEN),
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 30 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 0);
    assert_eq!(state.balances.get(2).unwrap(), 10 * STROOPS_PER_TOKEN);
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
    f.client()
        .deposit_with_split(&f.admin, &(10 * STROOPS_PER_TOKEN), &-1, &(5 * STROOPS_PER_TOKEN));
}

#[test]
fn spend_deducts_from_envelope_and_returns_tokens() {
    let (f, member) = Fixture::funded_with_member();
    let amount = 10 * STROOPS_PER_TOKEN;
    let memo = String::from_str(&f.env, "coffee");
    f.client().spend(&member, &Envelope::Groceries, &amount, &memo);
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&member), amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn spend_rejects_non_member() {
    let f = Fixture::funded();
    let nobody = Address::generate(&f.env);
    f.client().spend(
        &nobody,
        &Envelope::Groceries,
        &(1 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "x"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn spend_rejects_insufficient_balance() {
    let f = Fixture::funded();
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(1_000 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "x"),
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
        &String::from_str(&f.env, "x"),
    );
}

#[test]
fn spend_works_across_envelopes_independently() {
    let f = Fixture::funded();
    let memo = String::from_str(&f.env, "x");
    f.client()
        .spend(&f.admin, &Envelope::Groceries, &(10 * STROOPS_PER_TOKEN), &memo);
    f.client()
        .spend(&f.admin, &Envelope::Tuition, &(5 * STROOPS_PER_TOKEN), &memo);
    f.client()
        .spend(&f.admin, &Envelope::Savings, &(2 * STROOPS_PER_TOKEN), &memo);
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 25 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 18 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&f.admin), 900 * STROOPS_PER_TOKEN + 17 * STROOPS_PER_TOKEN);
}

#[test]
fn spend_on_behalf_credits_member_wallet() {
    let (f, member) = Fixture::funded_with_member();
    let amount = 10 * STROOPS_PER_TOKEN;
    let memo = String::from_str(&f.env, "release");
    f.client().spend_on_behalf(
        &member,
        &Envelope::Tuition,
        &amount,
        &memo,
    );
    let state = f.client().get_state();
    assert_eq!(state.balances.get(1).unwrap(), 20 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&member), amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn spend_on_behalf_rejects_non_member() {
    let f = Fixture::funded();
    let nobody = Address::generate(&f.env);
    f.client().spend_on_behalf(
        &nobody,
        &Envelope::Groceries,
        &(1 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "x"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn spend_on_behalf_rejects_insufficient_balance() {
    let (f, member) = Fixture::funded_with_member();
    f.client().spend_on_behalf(
        &member,
        &Envelope::Groceries,
        &(1_000 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "x"),
    );
}

// ─── Sub-account tests ────────────────────────────────────────────────────

#[test]
fn join_as_subaccount_registers_with_zero_balance_unlocked() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let state = f.client().get_state();
    assert_eq!(state.subaccounts.len(), 1);
    let s = state.subaccounts.get(0).unwrap();
    assert_eq!(s.address, kid);
    assert_eq!(s.balance, 0);
    assert!(!s.locked);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn join_as_subaccount_rejects_existing_member() {
    let (f, member) = Fixture::funded_with_member();
    let token = f.create_subaccount_invite_token(0x22);
    f.client().join_as_subaccount(&member, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn join_as_subaccount_rejects_duplicate() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let token = f.create_subaccount_invite_token(0x33);
    f.client().join_as_subaccount(&kid, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn join_as_subaccount_rejects_member_invite_token() {
    let f = Fixture::new();
    let member_token = f.create_invite();
    let kid = Address::generate(&f.env);
    f.client().join_as_subaccount(&kid, &member_token);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn join_as_subaccount_rejects_when_at_max() {
    let f = Fixture::funded();
    for i in 0..(MAX_SUBACCOUNTS + 1) {
        let kid = Address::generate(&f.env);
        let token = f.create_subaccount_invite_token(0x40 + (i as u8));
        f.client().join_as_subaccount(&kid, &token);
    }
}

#[test]
fn fund_subaccount_debits_envelope_and_credits_sub() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let amount = 10 * STROOPS_PER_TOKEN;
    f.client().fund_subaccount(&Envelope::Groceries, &kid, &amount);
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(state.subaccounts.get(0).unwrap().balance, amount);
}

#[test]
fn fund_subaccount_accumulates_across_envelopes() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client()
        .fund_subaccount(&Envelope::Groceries, &kid, &(5 * STROOPS_PER_TOKEN));
    f.client()
        .fund_subaccount(&Envelope::Tuition, &kid, &(3 * STROOPS_PER_TOKEN));
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 45 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 27 * STROOPS_PER_TOKEN);
    assert_eq!(state.subaccounts.get(0).unwrap().balance, 8 * STROOPS_PER_TOKEN);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn fund_subaccount_rejects_unknown_recipient() {
    let f = Fixture::funded();
    let stranger = Address::generate(&f.env);
    f.client()
        .fund_subaccount(&Envelope::Groceries, &stranger, &(1 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn fund_subaccount_rejects_envelope_underflow() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client()
        .fund_subaccount(&Envelope::Groceries, &kid, &(1000 * STROOPS_PER_TOKEN));
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
    let amount = 5 * STROOPS_PER_TOKEN;
    f.client()
        .fund_subaccount(&Envelope::Groceries, &kid, &(2 * amount));
    f.client()
        .spend_from_subaccount(&kid, &amount, &String::from_str(&f.env, "snack"));
    let state = f.client().get_state();
    assert_eq!(state.subaccounts.get(0).unwrap().balance, amount);
    assert_eq!(f.token().balance(&kid), amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn spend_from_subaccount_rejects_when_locked() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let amount = 5 * STROOPS_PER_TOKEN;
    f.client()
        .fund_subaccount(&Envelope::Groceries, &kid, &(2 * amount));
    f.client().lock_subaccount(&kid);
    f.client()
        .spend_from_subaccount(&kid, &amount, &String::from_str(&f.env, "x"));
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn spend_from_subaccount_rejects_unknown_caller() {
    let f = Fixture::funded();
    let stranger = Address::generate(&f.env);
    f.client()
        .spend_from_subaccount(&stranger, &(1 * STROOPS_PER_TOKEN), &String::from_str(&f.env, "x"));
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn spend_from_subaccount_rejects_over_balance() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client()
        .fund_subaccount(&Envelope::Groceries, &kid, &(2 * STROOPS_PER_TOKEN));
    f.client().spend_from_subaccount(
        &kid,
        &(3 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "x"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn spend_from_subaccount_rejects_zero() {
    let (f, kid) = Fixture::funded_with_subaccount();
    f.client()
        .spend_from_subaccount(&kid, &0, &String::from_str(&f.env, "x"));
}

#[test]
fn lock_then_unlock_restores_spend_ability() {
    let (f, kid) = Fixture::funded_with_subaccount();
    let amount = 5 * STROOPS_PER_TOKEN;
    f.client()
        .fund_subaccount(&Envelope::Groceries, &kid, &(2 * amount));
    f.client().lock_subaccount(&kid);
    f.client().unlock_subaccount(&kid);
    f.client()
        .spend_from_subaccount(&kid, &amount, &String::from_str(&f.env, "ok"));
    assert_eq!(f.token().balance(&kid), amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn lock_subaccount_rejects_unknown_target() {
    let f = Fixture::funded();
    let stranger = Address::generate(&f.env);
    f.client().lock_subaccount(&stranger);
}

// ─── Earn: MockUSDY-backed ────────────────────────────────────────────────

use mock_usdy::{MockUSDY, MockUSDYClient};

/// Extends Fixture with a pre-deployed MockUSDY instance that wraps the
/// fixture's payment token. Handles USDY reserve pre-funding so redemptions
/// with accrued yield can pay out without underflow. Earn is not enabled
/// on the wallet by `new()` — call `enable_earn()` when a test wants that.
struct UsdyFixture {
    sobre: Fixture,
    usdy: Address,
}

impl UsdyFixture {
    fn new() -> Self {
        Self::build(Fixture::funded())
    }

    fn new_unfunded() -> Self {
        Self::build(Fixture::new())
    }

    fn build(sobre: Fixture) -> Self {
        let env = &sobre.env;
        let usdy = env.register(
            MockUSDY,
            (),
        );
        MockUSDYClient::new(env, &usdy).init(&sobre.payment_token);
        // Pre-fund USDY with 10k underlying so redemptions that include
        // accrued yield have somewhere to draw the interest portion from.
        // Deposits themselves push USDC into USDY at 1:1, so the reserve
        // only needs to cover expected yield across the test's timeline.
        token::StellarAssetClient::new(env, &sobre.payment_token)
            .mint(&usdy, &(10_000 * STROOPS_PER_TOKEN));
        Self { sobre, usdy }
    }

    fn enable_earn(&self) {
        self.sobre.client().earn_enable(&self.usdy);
    }

    /// Reads the position for `envelope`, defaulting to zero when absent.
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
            principal: 0,
            current_value: 0,
            supplied_total: 0,
            withdrawn_total: 0,
            interest_earned: 0,
        }
    }
}

#[test]
fn earn_enable_migrates_savings_cache_to_usdy() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let state = ef.sobre.client().get_state();
    assert_eq!(state.balances.get(2).unwrap(), 0);
    let pos = ef.position(Envelope::Savings);
    assert_eq!(pos.principal, 20 * STROOPS_PER_TOKEN);
    assert_eq!(pos.supplied_total, 20 * STROOPS_PER_TOKEN);
    // current_value at t=0 == principal (no yield yet).
    assert_eq!(pos.current_value, 20 * STROOPS_PER_TOKEN);
}

#[test]
fn earn_enable_with_empty_savings_leaves_no_position() {
    let ef = UsdyFixture::new_unfunded();
    ef.enable_earn();
    let state = ef.sobre.client().get_state();
    let earn = state.earn.get(0).expect("enabled");
    assert_eq!(earn.usdy_contract, ef.usdy);
    assert_eq!(earn.positions.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn earn_enable_rejects_second_call() {
    let ef = UsdyFixture::new_unfunded();
    ef.enable_earn();
    ef.enable_earn();
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn earn_enable_rejects_underlying_mismatch() {
    // A USDY contract wrapping a token other than Sobre's payment token
    // gets rejected at enable time — otherwise deposit/redeem would move
    // the wrong asset.
    let f = Fixture::funded();
    let other_token_admin = Address::generate(&f.env);
    let other_token = f
        .env
        .register_stellar_asset_contract_v2(other_token_admin.clone())
        .address();
    let usdy = f.env.register(MockUSDY, ());
    MockUSDYClient::new(&f.env, &usdy).init(&other_token);
    f.client().earn_enable(&usdy);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn earn_supply_rejects_when_disabled() {
    let f = Fixture::funded();
    f.client()
        .earn_supply(&Envelope::Groceries, &(5 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn earn_withdraw_rejects_when_disabled() {
    let f = Fixture::funded();
    f.client()
        .earn_withdraw(&Envelope::Groceries, &(5 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn earn_supply_rejects_zero() {
    let ef = UsdyFixture::new_unfunded();
    ef.enable_earn();
    ef.sobre.client().earn_supply(&Envelope::Groceries, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn earn_supply_rejects_amount_over_envelope_balance() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    ef.sobre
        .client()
        .earn_supply(&Envelope::Groceries, &(1000 * STROOPS_PER_TOKEN));
}

#[test]
fn earn_supply_debits_envelope_and_records_principal() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    // Groceries has 50 XLM; move 10 into USDY under Groceries attribution.
    let amount = 10 * STROOPS_PER_TOKEN;
    ef.sobre.client().earn_supply(&Envelope::Groceries, &amount);
    let state = ef.sobre.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    let pos = ef.position(Envelope::Groceries);
    assert_eq!(pos.principal, amount);
    assert_eq!(pos.supplied_total, amount);
}

#[test]
fn earn_withdraw_credits_envelope_and_reduces_principal() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    // Savings' 20 XLM already migrated to USDY at enable. Withdraw half.
    let amount = 10 * STROOPS_PER_TOKEN;
    ef.sobre.client().earn_withdraw(&Envelope::Savings, &amount);
    let state = ef.sobre.client().get_state();
    assert_eq!(state.balances.get(2).unwrap(), amount);
    let pos = ef.position(Envelope::Savings);
    assert_eq!(pos.principal, 10 * STROOPS_PER_TOKEN);
    assert_eq!(pos.withdrawn_total, amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn earn_withdraw_rejects_when_no_position() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    ef.sobre
        .client()
        .earn_withdraw(&Envelope::Groceries, &(1 * STROOPS_PER_TOKEN));
}

#[test]
fn earn_state_is_empty_vec_when_disabled() {
    let f = Fixture::funded();
    let state = f.client().get_state();
    assert_eq!(state.earn.len(), 0);
}

#[test]
fn earn_supply_then_withdraw_round_trips_principal() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let amount = 25 * STROOPS_PER_TOKEN;
    ef.sobre.client().earn_supply(&Envelope::Groceries, &amount);
    ef.sobre.client().earn_withdraw(&Envelope::Groceries, &amount);
    let state = ef.sobre.client().get_state();
    // Groceries cache restored (deposit put 50 in, supply moved 25 out, withdraw moved 25 back).
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    let pos = ef.position(Envelope::Groceries);
    assert_eq!(pos.principal, 0);
    assert_eq!(pos.supplied_total, amount);
    assert_eq!(pos.withdrawn_total, amount);
}

#[test]
fn earn_supply_isolates_per_envelope_bookkeeping() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let a = 10 * STROOPS_PER_TOKEN;
    let b = 15 * STROOPS_PER_TOKEN;
    ef.sobre.client().earn_supply(&Envelope::Groceries, &a);
    ef.sobre.client().earn_supply(&Envelope::Tuition, &b);
    let pg = ef.position(Envelope::Groceries);
    let pt = ef.position(Envelope::Tuition);
    assert_eq!(pg.principal, a);
    assert_eq!(pt.principal, b);
    // Neither envelope's principal was contaminated by the other's supply.
    assert_ne!(pg.principal, pt.principal);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn earn_withdraw_cannot_drain_sibling_envelope() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    // Groceries has some USDY principal, Tuition has none. Attempt to
    // withdraw from Tuition — must reject rather than dip into Groceries'.
    ef.sobre
        .client()
        .earn_supply(&Envelope::Groceries, &(10 * STROOPS_PER_TOKEN));
    ef.sobre
        .client()
        .earn_withdraw(&Envelope::Tuition, &(1 * STROOPS_PER_TOKEN));
}

#[test]
fn deposit_with_split_auto_supplies_savings_when_earn_on() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    // Post-migration, Savings cache is 0 and USDY holds the pre-Earn balance.
    // A fresh deposit's Savings share should route to USDY, keeping cache at 0.
    ef.sobre.client().deposit_with_split(
        &ef.sobre.admin,
        &0,
        &0,
        &(10 * STROOPS_PER_TOKEN),
    );
    let state = ef.sobre.client().get_state();
    assert_eq!(state.balances.get(2).unwrap(), 0);
    let pos = ef.position(Envelope::Savings);
    // 20 pre-existing + 10 new = 30 principal after the auto-supply.
    assert_eq!(pos.principal, 30 * STROOPS_PER_TOKEN);
    assert_eq!(pos.supplied_total, 30 * STROOPS_PER_TOKEN);
}

#[test]
fn spend_savings_auto_withdraws_from_usdy_when_short() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    // Savings cache = 0, USDY principal = 20. Spend 5 XLM from Savings —
    // ensure_envelope_liquidity should auto-redeem to make it work.
    ef.sobre.client().spend(
        &ef.sobre.admin,
        &Envelope::Savings,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&ef.sobre.env, "coffee"),
    );
    let state = ef.sobre.client().get_state();
    // Cache stays at 0 (the redeem was exactly-what-was-needed).
    assert_eq!(state.balances.get(2).unwrap(), 0);
    let pos = ef.position(Envelope::Savings);
    assert_eq!(pos.principal, 15 * STROOPS_PER_TOKEN);
    assert_eq!(pos.withdrawn_total, 5 * STROOPS_PER_TOKEN);
}

#[test]
fn spend_groceries_does_not_touch_usdy() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let g_before = ef.position(Envelope::Groceries);
    ef.sobre.client().spend(
        &ef.sobre.admin,
        &Envelope::Groceries,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&ef.sobre.env, "x"),
    );
    let g_after = ef.position(Envelope::Groceries);
    // Non-Savings envelopes never route through USDY, so principal
    // (which was 0) stays 0 after a spend.
    assert_eq!(g_before.principal, 0);
    assert_eq!(g_after.principal, 0);
}

#[test]
fn fund_subaccount_from_savings_auto_withdraws_from_usdy() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let kid = Address::generate(&ef.sobre.env);
    let token = ef.sobre.create_subaccount_invite_token(0x66);
    ef.sobre.client().join_as_subaccount(&kid, &token);
    ef.sobre
        .client()
        .fund_subaccount(&Envelope::Savings, &kid, &(7 * STROOPS_PER_TOKEN));
    let state = ef.sobre.client().get_state();
    // Post-fund the auto-redeem left the cache at 0 (redeemed exactly the
    // shortfall, then the fund debited it right back to 0).
    assert_eq!(state.balances.get(2).unwrap(), 0);
    assert_eq!(state.subaccounts.get(0).unwrap().balance, 7 * STROOPS_PER_TOKEN);
    let pos = ef.position(Envelope::Savings);
    assert_eq!(pos.principal, 13 * STROOPS_PER_TOKEN);
    assert_eq!(pos.withdrawn_total, 7 * STROOPS_PER_TOKEN);
}

#[test]
fn close_wallet_sweeps_usdy_positions_when_earn_on() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let admin_before = ef.sobre.token().balance(&ef.sobre.admin);
    ef.sobre.client().close_wallet();
    // Contract's payment-token balance goes to zero; admin receives the sum.
    assert_eq!(ef.sobre.token().balance(&ef.sobre.contract_id), 0);
    assert_eq!(
        ef.sobre.token().balance(&ef.sobre.admin),
        admin_before + 100 * STROOPS_PER_TOKEN,
    );
}

#[test]
fn interest_earned_ticks_up_with_ledger_time() {
    let ef = UsdyFixture::new();
    ef.enable_earn();
    let pos_before = ef.position(Envelope::Savings);
    // Advance ledger a full year at MockUSDY's 5% APY — current_value
    // should reflect the appreciation.
    ef.sobre
        .env
        .ledger()
        .with_mut(|l| l.timestamp += 365 * 24 * 3600);
    let pos_after = ef.position(Envelope::Savings);
    assert!(
        pos_after.current_value > pos_before.current_value,
        "current_value should tick up after a year"
    );
    assert!(pos_after.interest_earned > 0);
    // Supplied/withdrawn totals are monotonic and unchanged by yield accrual.
    assert_eq!(pos_after.supplied_total, pos_before.supplied_total);
    assert_eq!(pos_after.withdrawn_total, pos_before.withdrawn_total);
    // 5% of 20 XLM stroops ≈ 1 XLM stroops appreciation.
    assert!(pos_after.current_value >= (21 * STROOPS_PER_TOKEN) - 1000);
}

// ─── Grow: 48h timelock + Blend + Soroswap sandwich ───────────────────────

/// Wall-clock 48 hours in seconds — hardcoded here so tests are honest
/// about the value they're checking against. If the contract's constant
/// ever changes, this test fails and forces the copy to stay in sync.
const GROW_TIMELOCK_SECS: u64 = 48 * 3600;

/// Extends UsdyFixture with a Blend testnet-style pool set up around an
/// XLM SAC (distinct from the fixture's payment_token, i.e. the "USDC")
/// and a pre-funded MockSoroswap router for the swap sandwich.
struct GrowFixture {
    usdy: UsdyFixture,
    blend_pool: Address,
    xlm_asset: Address,
    soroswap_router: Address,
}

impl GrowFixture {
    fn new() -> Self {
        Self::build(UsdyFixture::new())
    }

    fn new_unfunded() -> Self {
        Self::build(UsdyFixture::new_unfunded())
    }

    fn build(usdy: UsdyFixture) -> Self {
        let env = usdy.sobre.env.clone();

        let deployer = Address::generate(&env);
        // XLM SAC (distinct from payment_token which represents USDC in tests).
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
        let pool_addr = blend.pool_factory.mock_all_auths().deploy(
            &deployer,
            &String::from_str(&env, "sobre-grow-test"),
            &BytesN::<32>::random(&env),
            &Address::generate(&env),
            &0_1000000,
            &4,
            &1_0000000,
        );
        let pool_client = blend_pool::Client::new(&env, &pool_addr);
        pool_client
            .mock_all_auths()
            .queue_set_reserve(&xlm_asset, &default_reserve_config());
        pool_client.mock_all_auths().set_reserve(&xlm_asset);
        blend
            .backstop
            .mock_all_auths()
            .deposit(&deployer, &pool_addr, &50_000_0000000);
        pool_client.mock_all_auths().set_status(&3);
        pool_client.mock_all_auths().update_status();

        // Deploy MockSoroswap and pre-fund its reserves with lots of both
        // tokens so swaps in either direction settle without underflow.
        let soroswap_router = env.register(mock_soroswap::MockSoroswap, ());
        mock_soroswap::MockSoroswapClient::new(&env, &soroswap_router)
            .init(&usdy.sobre.payment_token, &xlm_asset);
        token::StellarAssetClient::new(&env, &usdy.sobre.payment_token)
            .mint(&soroswap_router, &(1_000_000 * STROOPS_PER_TOKEN));
        token::StellarAssetClient::new(&env, &xlm_asset)
            .mint(&soroswap_router, &(10_000_000 * STROOPS_PER_TOKEN));

        Self {
            usdy,
            blend_pool: pool_addr,
            xlm_asset,
            soroswap_router,
        }
    }

    fn enable_grow(&self) {
        self.usdy.sobre.client().grow_enable(
            &self.blend_pool,
            &self.xlm_asset,
            &self.soroswap_router,
        );
    }

    fn sobre(&self) -> &Fixture {
        &self.usdy.sobre
    }
}

#[test]
fn grow_enable_marks_state_and_zeroes_balance() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    let state = gf.sobre().client().get_state();
    assert!(state.grow_enabled);
    assert_eq!(state.grow_balance, 0);
    assert_eq!(state.grow_requests.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn grow_enable_rejects_second_call() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.enable_grow();
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
fn grow_transfer_from_savings_supplies_via_soroswap_and_blend() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    // Savings has 20 USDC after Fixture::funded. Move 15 into Grow.
    let amount = 15 * STROOPS_PER_TOKEN;
    gf.sobre().client().grow_transfer_from_savings(&amount);
    let state = gf.sobre().client().get_state();
    // Savings cache drops from 20 → 5.
    assert_eq!(state.balances.get(2).unwrap(), 5 * STROOPS_PER_TOKEN);
    // Grow bucket value in USDC: 15 USDC was supplied. With MockSoroswap's
    // 1:8 rate and 1:1 Blend b_rate at t=0, current value round-trips
    // back to ≈15 USDC (small floor-division rounding, within 1 stroop).
    assert!(state.grow_balance >= amount - 10);
    assert!(state.grow_balance <= amount + 10);
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
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre().client().grow_transfer_from_savings(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn grow_transfer_rejects_over_savings_balance() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(1000 * STROOPS_PER_TOKEN));
}

#[test]
fn grow_request_queues_and_reserves_amount() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    let id = gf
        .sobre()
        .client()
        .request_grow_withdrawal(&(5 * STROOPS_PER_TOKEN));
    let state = gf.sobre().client().get_state();
    assert_eq!(state.grow_requests.len(), 1);
    let r = state.grow_requests.get(0).unwrap();
    assert_eq!(r.id, id);
    assert_eq!(r.amount, 5 * STROOPS_PER_TOKEN);
    // unlock_at was set to now + GROW_TIMELOCK_SECS at request time.
    assert_eq!(
        r.unlock_at,
        gf.sobre().env.ledger().timestamp() + GROW_TIMELOCK_SECS
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn grow_request_rejects_when_reservations_exceed_balance() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    // First request reserves 10; second attempt requests 10 more, but the
    // bucket only has ~15 USDC-equivalent (minus a small rounding delta).
    gf.sobre()
        .client()
        .request_grow_withdrawal(&(10 * STROOPS_PER_TOKEN));
    gf.sobre()
        .client()
        .request_grow_withdrawal(&(10 * STROOPS_PER_TOKEN));
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
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    let id = gf
        .sobre()
        .client()
        .request_grow_withdrawal(&(5 * STROOPS_PER_TOKEN));
    // Same-ledger execute before the 48h wait — must trap.
    gf.sobre().client().execute_grow_withdrawal(&id);
}

#[test]
fn grow_execute_at_unlock_transfers_usdc_and_clears_request() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    let amount = 5 * STROOPS_PER_TOKEN;
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    let id = gf.sobre().client().request_grow_withdrawal(&amount);
    let admin_before = gf.sobre().token().balance(&gf.sobre().admin);
    gf.sobre()
        .env
        .ledger()
        .with_mut(|l| l.timestamp += GROW_TIMELOCK_SECS);
    gf.sobre().client().execute_grow_withdrawal(&id);
    // Admin received exactly `amount` USDC.
    assert_eq!(
        gf.sobre().token().balance(&gf.sobre().admin),
        admin_before + amount,
    );
    let state = gf.sobre().client().get_state();
    assert_eq!(state.grow_requests.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn grow_execute_with_unknown_id_fails() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre().client().execute_grow_withdrawal(&999);
}

#[test]
fn grow_cancel_clears_request_before_unlock() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(15 * STROOPS_PER_TOKEN));
    let id = gf
        .sobre()
        .client()
        .request_grow_withdrawal(&(5 * STROOPS_PER_TOKEN));
    gf.sobre().client().cancel_grow_withdrawal(&id);
    let state = gf.sobre().client().get_state();
    assert_eq!(state.grow_requests.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn grow_cancel_with_unknown_id_fails() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre().client().cancel_grow_withdrawal(&999);
}

#[test]
fn grow_execute_after_multiple_requests_only_clears_target() {
    let gf = GrowFixture::new();
    gf.enable_grow();
    gf.sobre()
        .client()
        .grow_transfer_from_savings(&(20 * STROOPS_PER_TOKEN));
    let id1 = gf
        .sobre()
        .client()
        .request_grow_withdrawal(&(3 * STROOPS_PER_TOKEN));
    let id2 = gf
        .sobre()
        .client()
        .request_grow_withdrawal(&(5 * STROOPS_PER_TOKEN));
    gf.sobre()
        .env
        .ledger()
        .with_mut(|l| l.timestamp += GROW_TIMELOCK_SECS);
    gf.sobre().client().execute_grow_withdrawal(&id2);
    let state = gf.sobre().client().get_state();
    assert_eq!(state.grow_requests.len(), 1);
    assert_eq!(state.grow_requests.get(0).unwrap().id, id1);
}

// ─── deposit_from_xlm: PDAX-ramp entry point ─────────────────────────────

#[test]
fn deposit_from_xlm_swaps_and_splits_when_grow_on() {
    // Fresh wallet (no envelope funding yet) with Grow enabled so
    // deposit_from_xlm can read the Soroswap config out of Grow storage.
    let gf = GrowFixture::new_unfunded();
    gf.enable_grow();
    // Simulate PDAX crediting 100 XLM to relay, then relay invoking the
    // ramp entry point. Mock rate: 100 XLM in → 12.5 USDC out (rate 1:8).
    let relay = Address::generate(&gf.sobre().env);
    let xlm_in = 100 * STROOPS_PER_TOKEN;
    token::StellarAssetClient::new(&gf.sobre().env, &gf.xlm_asset)
        .mint(&relay, &xlm_in);
    let split = 12 * STROOPS_PER_TOKEN + 5_000_000; // 12.5 USDC
    let groceries = 5 * STROOPS_PER_TOKEN;
    let tuition = 5 * STROOPS_PER_TOKEN;
    let savings = split - groceries - tuition; // 2.5 USDC
    gf.sobre().client().deposit_from_xlm(
        &relay,
        &xlm_in,
        &groceries,
        &tuition,
        &savings,
    );
    let state = gf.sobre().client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), groceries);
    assert_eq!(state.balances.get(1).unwrap(), tuition);
    assert_eq!(state.balances.get(2).unwrap(), savings);
    // XLM was consumed by the swap; USDC balance on the contract equals
    // the split total (Soroswap's payout of 12.5 USDC).
    assert_eq!(
        gf.sobre().token().balance(&gf.sobre().contract_id),
        split
    );
}

#[test]
fn deposit_from_xlm_routes_savings_to_usdy_when_earn_on() {
    let gf = GrowFixture::new_unfunded();
    gf.usdy.enable_earn();
    gf.enable_grow();
    let relay = Address::generate(&gf.sobre().env);
    let xlm_in = 100 * STROOPS_PER_TOKEN;
    token::StellarAssetClient::new(&gf.sobre().env, &gf.xlm_asset)
        .mint(&relay, &xlm_in);
    let savings = 5 * STROOPS_PER_TOKEN;
    gf.sobre().client().deposit_from_xlm(
        &relay,
        &xlm_in,
        &0,
        &0,
        &savings,
    );
    // Savings cache stays at 0 (auto-supplied to USDY).
    let state = gf.sobre().client().get_state();
    assert_eq!(state.balances.get(2).unwrap(), 0);
    let pos = gf.usdy.position(Envelope::Savings);
    assert_eq!(pos.principal, savings);
    assert_eq!(pos.supplied_total, savings);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn deposit_from_xlm_rejects_when_grow_disabled() {
    // Grow-disabled wallets have no Soroswap config to swap through, so
    // the ramp entry point traps up-front.
    let f = Fixture::funded();
    let relay = Address::generate(&f.env);
    f.client()
        .deposit_from_xlm(&relay, &(100 * STROOPS_PER_TOKEN), &0, &0, &(5 * STROOPS_PER_TOKEN));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn deposit_from_xlm_rejects_zero_split() {
    let gf = GrowFixture::new_unfunded();
    gf.enable_grow();
    let relay = Address::generate(&gf.sobre().env);
    let xlm_in = 100 * STROOPS_PER_TOKEN;
    token::StellarAssetClient::new(&gf.sobre().env, &gf.xlm_asset)
        .mint(&relay, &xlm_in);
    gf.sobre()
        .client()
        .deposit_from_xlm(&relay, &xlm_in, &0, &0, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn deposit_from_xlm_rejects_zero_xlm() {
    let gf = GrowFixture::new_unfunded();
    gf.enable_grow();
    let relay = Address::generate(&gf.sobre().env);
    gf.sobre()
        .client()
        .deposit_from_xlm(&relay, &0, &(5 * STROOPS_PER_TOKEN), &0, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn deposit_from_xlm_rejects_split_over_swap_payout() {
    // Caller claims a split totaling MORE than the Soroswap payout can
    // cover — contract traps with InsufficientBalance rather than
    // credit envelopes with money that isn't there.
    let gf = GrowFixture::new_unfunded();
    gf.enable_grow();
    let relay = Address::generate(&gf.sobre().env);
    let xlm_in = 8 * STROOPS_PER_TOKEN; // rate 1:8 → 1 USDC out
    token::StellarAssetClient::new(&gf.sobre().env, &gf.xlm_asset)
        .mint(&relay, &xlm_in);
    // Claim 5 USDC split — but only 1 USDC swaps out.
    gf.sobre()
        .client()
        .deposit_from_xlm(&relay, &xlm_in, &(5 * STROOPS_PER_TOKEN), &0, &0);
}

#[test]
fn grow_transfer_from_savings_auto_redeems_usdy_when_short() {
    // With Earn enabled, Savings' cache is 0 (post-migration to USDY).
    // grow_transfer_from_savings must auto-redeem from USDY first,
    // then swap USDC→XLM and supply to Blend.
    let gf = GrowFixture::new();
    gf.usdy.enable_earn();
    gf.enable_grow();
    let state_before = gf.sobre().client().get_state();
    assert_eq!(state_before.balances.get(2).unwrap(), 0);
    let amount = 10 * STROOPS_PER_TOKEN;
    gf.sobre().client().grow_transfer_from_savings(&amount);
    let state = gf.sobre().client().get_state();
    // Savings USDY principal drops from 20 → 10.
    let pos = gf.usdy.position(Envelope::Savings);
    assert_eq!(pos.principal, 10 * STROOPS_PER_TOKEN);
    // Grow bucket carries ≈10 USDC of value.
    assert!(state.grow_balance >= amount - 10);
    assert!(state.grow_balance <= amount + 10);
}
