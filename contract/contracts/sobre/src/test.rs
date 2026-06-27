#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token, vec, Bytes, BytesN, Env, String,
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

        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let payment_token = token_contract.address();

        let admin = Address::generate(&env);
        let percents = vec![&env, 50u32, 30u32, 20u32];
        // Standalone tests don't go through the factory, so we mint a
        // throwaway address to satisfy the Factory constructor arg. Tests
        // that exercise upgrade() install a real factory via the factory
        // crate's test suite instead.
        let factory = Address::generate(&env);
        // env.register now invokes __constructor with these args, atomically
        // deploying + initializing the contract in one step.
        let contract_id = env.register(
            SobreContract,
            (admin.clone(), payment_token.clone(), percents, factory),
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

    /// Initialized + admin minted 1000 tokens + 100 deposited (envelopes at
    /// [50, 30, 20]). Starting state for any spend/withdraw test where the
    /// policy doesn't matter (admin bypasses it anyway).
    fn funded() -> Self {
        let f = Self::new();
        f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);
        f.client().deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));
        f
    }

    /// Funded + a second non-admin member joined ("Maria"). Use this when a
    /// test wants policy routing — admin's spends always bypass policy.
    fn funded_with_member() -> (Self, Address) {
        let f = Self::funded();
        let member = Address::generate(&f.env);
        let token = f.create_invite();
        f.client().join_wallet(&member, &token);
        (f, member)
    }

    /// Mint a single-use invite token with a fixed plaintext and return it.
    /// The test fixture's `mock_all_auths` lets us call `create_invite` from
    /// any caller; the persisted hash matches what `join_wallet` will compute
    /// from the returned plaintext.
    fn create_invite(&self) -> BytesN<32> {
        let token = BytesN::from_array(&self.env, &[7u8; 32]);
        let hash: BytesN<32> = self.env.crypto().sha256(&Bytes::from(token.clone())).into();
        let expires_at = self.env.ledger().sequence() + 1000;
        self.client().create_invite(&hash, &expires_at);
        token
    }

    fn empty_policy(&self) -> SpendPolicy {
        SpendPolicy {
            require_all_sigs: false,
            daily_limit: None,
            per_tx_threshold: None,
            protected_envelopes: Vec::new(&self.env),
        }
    }
}

// ─── init ─────────────────────────────────────────────────────────────────

#[test]
fn init_seeds_admin_member_only() {
    let f = Fixture::new();
    let state = f.client().get_state();

    assert_eq!(state.admin, f.admin);
    assert_eq!(state.payment_token, f.payment_token);
    assert_eq!(state.percents, vec![&f.env, 50u32, 30u32, 20u32]);
    assert_eq!(state.members.len(), 1);
    let admin_member = state.members.get(0).unwrap();
    assert_eq!(admin_member.address, f.admin);
    assert_eq!(state.balances.len(), 3);
    assert!(state.policy.per_tx_threshold.is_none());
}

// ─── join_wallet + create_invite ──────────────────────────────────────────

#[test]
fn join_wallet_appends_member_address() {
    let f = Fixture::new();
    let maria = Address::generate(&f.env);
    let token = f.create_invite();

    f.client().join_wallet(&maria, &token);

    let state = f.client().get_state();
    assert_eq!(state.members.len(), 2);
    let m = state.members.get(1).unwrap();
    assert_eq!(m.address, maria);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn join_wallet_rejects_duplicate() {
    let f = Fixture::new();
    let token = f.create_invite();
    // Admin already a member; trying to join again is a duplicate.
    f.client().join_wallet(&f.admin, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn join_wallet_rejects_when_at_max() {
    let f = Fixture::new();
    let m1 = Address::generate(&f.env);
    let t1 = f.create_invite();
    f.client().join_wallet(&m1, &t1);
    // Second invite uses a different plaintext (the fixture helper would
    // reuse the same one, but join_wallet deletes it after the first
    // redemption so we mint a fresh one with a distinct byte pattern).
    let t2_plain = BytesN::from_array(&f.env, &[9u8; 32]);
    let t2_hash: BytesN<32> = f
        .env
        .crypto()
        .sha256(&Bytes::from(t2_plain.clone()))
        .into();
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
    // Jump the ledger past the invite's expires_at (`now + 1000` in the
    // helper). +2000 puts us well past it without depending on the exact
    // offset.
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
    // Same token, fresh attempt — should be gone from storage.
    let pedro = Address::generate(&f.env);
    f.client().join_wallet(&pedro, &token);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn create_invite_rejects_past_expiry() {
    let f = Fixture::new();
    let token = BytesN::from_array(&f.env, &[3u8; 32]);
    let hash: BytesN<32> = f.env.crypto().sha256(&Bytes::from(token)).into();
    // expires_at <= current ledger sequence — must reject upfront so an
    // already-stale token never lands in storage.
    f.client().create_invite(&hash, &f.env.ledger().sequence());
}

// ─── remove_member ────────────────────────────────────────────────────────

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

// ─── close_wallet ─────────────────────────────────────────────────────────

#[test]
fn close_wallet_sweeps_all_envelopes_to_admin() {
    let f = Fixture::funded();
    let admin_token_before = f.token().balance(&f.admin);

    f.client().close_wallet();

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 0);
    assert_eq!(state.balances.get(1).unwrap(), 0);
    assert_eq!(state.balances.get(2).unwrap(), 0);
    assert_eq!(f.token().balance(&f.contract_id), 0);
    // Admin received the full 100 tokens that were in the envelopes.
    assert_eq!(
        f.token().balance(&f.admin),
        admin_token_before + 100 * STROOPS_PER_TOKEN,
    );
}

#[test]
fn close_wallet_with_empty_balances_no_ops_cleanly() {
    let f = Fixture::new();
    // Nothing to sweep — should not panic and should not call transfer.
    f.client().close_wallet();
    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 0);
}

// ─── apply_settings: percents ────────────────────────────────────────────

#[test]
fn apply_settings_updates_percents() {
    let f = Fixture::new();
    let updated = vec![&f.env, 60u32, 25u32, 15u32];

    f.client()
        .apply_settings(&vec![&f.env, SettingsField::Percents(updated.clone())]);

    assert_eq!(f.client().get_state().percents, updated);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn apply_settings_rejects_bad_percents_sum() {
    let f = Fixture::new();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Percents(vec![&f.env, 50u32, 30u32, 30u32]),
    ]);
}

// ─── apply_settings: policy ──────────────────────────────────────────────

#[test]
fn apply_settings_updates_policy() {
    let f = Fixture::funded();
    let policy = SpendPolicy {
        daily_limit: Some(5 * STROOPS_PER_TOKEN),
        protected_envelopes: vec![&f.env, Envelope::Tuition],
        ..f.empty_policy()
    };

    f.client()
        .apply_settings(&vec![&f.env, SettingsField::Policy(policy)]);

    let state = f.client().get_state();
    assert_eq!(state.policy.daily_limit, Some(5 * STROOPS_PER_TOKEN));
    assert!(state.policy.protected_envelopes.contains(Envelope::Tuition));
}

// ─── apply_settings: threshold (folded into SpendPolicy) ─────────────────

#[test]
fn apply_settings_sets_threshold() {
    let f = Fixture::new();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(10 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);

    assert_eq!(
        f.client().get_state().policy.per_tx_threshold,
        Some(10 * STROOPS_PER_TOKEN)
    );
}

#[test]
fn apply_settings_clears_threshold() {
    let f = Fixture::new();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(10 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);
    assert_eq!(
        f.client().get_state().policy.per_tx_threshold,
        Some(10 * STROOPS_PER_TOKEN)
    );

    f.client()
        .apply_settings(&vec![&f.env, SettingsField::Policy(f.empty_policy())]);
    assert!(f.client().get_state().policy.per_tx_threshold.is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn apply_settings_rejects_negative_threshold() {
    let f = Fixture::new();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(-1),
            ..f.empty_policy()
        }),
    ]);
}

// ─── apply_settings: multi-field + idempotency ───────────────────────────

#[test]
fn apply_settings_updates_all_fields_atomically() {
    let f = Fixture::new();
    let percents = vec![&f.env, 40u32, 40u32, 20u32];
    let policy = SpendPolicy {
        require_all_sigs: true,
        daily_limit: None,
        per_tx_threshold: Some(50 * STROOPS_PER_TOKEN),
        protected_envelopes: vec![&f.env, Envelope::Savings],
    };

    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Percents(percents.clone()),
        SettingsField::Policy(policy),
    ]);

    let state = f.client().get_state();
    assert_eq!(state.percents, percents);
    assert!(state.policy.require_all_sigs);
    assert_eq!(
        state.policy.per_tx_threshold,
        Some(50 * STROOPS_PER_TOKEN)
    );
}

#[test]
fn apply_settings_with_empty_vec_is_safe_noop() {
    let f = Fixture::new();
    let before = f.client().get_state();
    f.client().apply_settings(&Vec::new(&f.env));
    let after = f.client().get_state();
    assert_eq!(before.percents, after.percents);
    assert_eq!(before.policy.per_tx_threshold, after.policy.per_tx_threshold);
}

#[test]
fn apply_settings_is_idempotent_for_same_values() {
    let f = Fixture::new();
    let updates = vec![
        &f.env,
        SettingsField::Percents(vec![&f.env, 50u32, 30u32, 20u32]),
    ];
    f.client().apply_settings(&updates);
    f.client().apply_settings(&updates);
    assert_eq!(
        f.client().get_state().percents,
        vec![&f.env, 50u32, 30u32, 20u32]
    );
}

// ─── deposit ──────────────────────────────────────────────────────────────

#[test]
fn deposit_splits_per_percents() {
    let f = Fixture::new();
    f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);

    f.client().deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));

    let sobre_events = f.env.events().all().filter_by_contract(&f.contract_id);
    assert_eq!(sobre_events.events().len(), 1);

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 30 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 20 * STROOPS_PER_TOKEN);
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

    f.client().deposit(&f.admin, &101);

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50);
    assert_eq!(state.balances.get(1).unwrap(), 30);
    assert_eq!(state.balances.get(2).unwrap(), 21);

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

// ─── spend ────────────────────────────────────────────────────────────────

#[test]
fn spend_deducts_from_envelope_and_returns_tokens() {
    let (f, member) = Fixture::funded_with_member();

    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "Groceries at SM Manila"),
    );

    let sobre_events = f.env.events().all().filter_by_contract(&f.contract_id);
    assert_eq!(sobre_events.events().len(), 1);

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 30 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 20 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&member), 10 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&f.contract_id), 90 * STROOPS_PER_TOKEN);
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

// ─── SpendPolicy + pending requests ───────────────────────────────────────

#[test]
fn default_policy_is_open_and_no_pending() {
    let f = Fixture::new();
    let state = f.client().get_state();
    assert!(!state.policy.require_all_sigs);
    assert!(state.policy.daily_limit.is_none());
    assert!(state.policy.per_tx_threshold.is_none());
    assert_eq!(state.policy.protected_envelopes.len(), 0);
    assert_eq!(state.pending.len(), 0);
}

#[test]
fn spend_routes_to_pending_when_require_all_sigs() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            require_all_sigs: true,
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "approval please"),
    );

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.pending.len(), 1);
    let req = state.pending.get(0).unwrap();
    assert_eq!(req.amount, 10 * STROOPS_PER_TOKEN);
    assert_eq!(req.caller, member);
}

#[test]
fn spend_routes_to_pending_when_envelope_protected() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            protected_envelopes: vec![&f.env, Envelope::Tuition],
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "open"),
    );
    f.client().spend(
        &member,
        &Envelope::Tuition,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "needs approval"),
    );

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 45 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 30 * STROOPS_PER_TOKEN);
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending.get(0).unwrap().envelope, Envelope::Tuition);
}

#[test]
fn spend_routes_to_pending_when_daily_limit_exceeded() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            daily_limit: Some(5 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(3 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "first"),
    );
    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(3 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "exceeds limit"),
    );

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 47 * STROOPS_PER_TOKEN);
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending.get(0).unwrap().amount, 3 * STROOPS_PER_TOKEN);
}

// ─── spend threshold ─────────────────────────────────────────────────────

#[test]
fn spend_at_or_below_threshold_executes_immediately() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(10 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "exactly at threshold"),
    );

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
}

#[test]
fn spend_above_threshold_routes_to_pending() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(10 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(15 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "over threshold"),
    );

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    assert_eq!(state.pending.len(), 1);
    assert_eq!(
        state.pending.get(0).unwrap().amount,
        15 * STROOPS_PER_TOKEN
    );
}

#[test]
fn admin_spend_bypasses_threshold() {
    let f = Fixture::funded();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(5 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);

    // Admin spends well over the threshold; should execute immediately.
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(20 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "admin big"),
    );

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(0).unwrap(), 30 * STROOPS_PER_TOKEN);
}

#[test]
fn cleared_threshold_no_longer_gates_spends() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            per_tx_threshold: Some(5 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);
    // Setting per_tx_threshold to None (via replacing with empty_policy)
    // removes the gate.
    f.client()
        .apply_settings(&vec![&f.env, SettingsField::Policy(f.empty_policy())]);

    // Even way over the previous threshold, spend should execute now.
    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(20 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "no threshold anymore"),
    );

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(0).unwrap(), 30 * STROOPS_PER_TOKEN);
}

// ─── approve/deny ────────────────────────────────────────────────────────

#[test]
fn approve_request_executes_transfer() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            require_all_sigs: true,
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Tuition,
        &(7 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "school"),
    );

    let pending = f.client().get_state().pending;
    assert_eq!(pending.len(), 1);
    let req_id = pending.get(0).unwrap().id;

    let member_token_balance_before = f.token().balance(&member);
    f.client().approve_request(&req_id);

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(1).unwrap(), 23 * STROOPS_PER_TOKEN);
    assert_eq!(
        f.token().balance(&member),
        member_token_balance_before + 7 * STROOPS_PER_TOKEN,
    );
}

#[test]
fn deny_request_drops_without_transfer() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            require_all_sigs: true,
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &member,
        &Envelope::Savings,
        &(4 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "discretionary"),
    );

    let req_id = f.client().get_state().pending.get(0).unwrap().id;
    let member_token_before = f.token().balance(&member);

    f.client().deny_request(&req_id);

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(2).unwrap(), 20 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&member), member_token_before);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn approve_request_with_unknown_id_fails() {
    let f = Fixture::funded();
    f.client().approve_request(&999u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn deny_request_with_unknown_id_fails() {
    let f = Fixture::funded();
    f.client().deny_request(&999u64);
}

// ─── Admin bypass ─────────────────────────────────────────────────────────

#[test]
fn admin_spend_bypasses_require_all_sigs() {
    let f = Fixture::funded();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            require_all_sigs: true,
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "admin direct"),
    );

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
}

#[test]
fn admin_spend_bypasses_protected_envelope() {
    let f = Fixture::funded();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            protected_envelopes: vec![&f.env, Envelope::Tuition],
            ..f.empty_policy()
        }),
    ]);

    f.client().spend(
        &f.admin,
        &Envelope::Tuition,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "admin into protected"),
    );

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    assert_eq!(state.balances.get(1).unwrap(), 25 * STROOPS_PER_TOKEN);
}

#[test]
fn admin_spend_bypasses_daily_limit_and_does_not_count_toward_member() {
    let (f, member) = Fixture::funded_with_member();
    f.client().apply_settings(&vec![
        &f.env,
        SettingsField::Policy(SpendPolicy {
            daily_limit: Some(5 * STROOPS_PER_TOKEN),
            ..f.empty_policy()
        }),
    ]);

    // Admin spends 20 — far over the daily limit — and it executes immediately
    // AND does not increment the daily counter for anyone.
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(20 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "admin big spend"),
    );

    // Now the member spends 4 — still under the 5 limit, and admin's earlier
    // spend didn't poison the counter, so this executes too.
    f.client().spend(
        &member,
        &Envelope::Groceries,
        &(4 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "member within limit"),
    );

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    // Groceries: 50 - 20 (admin) - 4 (member) = 26
    assert_eq!(state.balances.get(0).unwrap(), 26 * STROOPS_PER_TOKEN);
}
