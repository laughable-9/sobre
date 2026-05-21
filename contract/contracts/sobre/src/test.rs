#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, vec, Env, String,
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

    /// Initialized + alice minted 1000 tokens + 100 deposited (envelopes at
    /// [50, 30, 20]). Starting state for any spend/withdraw test.
    fn funded() -> Self {
        let f = Self::new();
        f.mint(&f.admin, 1000 * STROOPS_PER_TOKEN);
        f.client().deposit(&f.admin, &(100 * STROOPS_PER_TOKEN));
        f
    }

    fn empty_policy(&self) -> SpendPolicy {
        SpendPolicy {
            require_all_sigs: false,
            daily_limit: None,
            protected_envelopes: Vec::new(&self.env),
        }
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

// ─── Phase 4: spend ───────────────────────────────────────────────────────

#[test]
fn spend_deducts_from_envelope_and_returns_tokens() {
    let f = Fixture::funded();

    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "Groceries at SM Manila"),
    );

    let sobre_events = f.env.events().all().filter_by_contract(&f.contract_id);
    assert_eq!(sobre_events.events().len(), 1);

    let state = f.client().get_state();
    // Groceries dropped from 50 to 40; tuition/savings untouched.
    assert_eq!(state.balances.get(0).unwrap(), 40 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(1).unwrap(), 30 * STROOPS_PER_TOKEN);
    assert_eq!(state.balances.get(2).unwrap(), 20 * STROOPS_PER_TOKEN);

    // Tokens moved back to alice: started 1000, deposited 100, spent 10 → 910.
    assert_eq!(f.token().balance(&f.admin), 910 * STROOPS_PER_TOKEN);
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

    // Groceries holds 50 tokens, ask for 60.
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
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN); // groceries untouched
    assert_eq!(state.balances.get(1).unwrap(), 25 * STROOPS_PER_TOKEN); // tuition 30 - 5
    assert_eq!(state.balances.get(2).unwrap(), 18 * STROOPS_PER_TOKEN); // savings 20 - 2
}

// ─── SpendPolicy + pending requests ───────────────────────────────────────

#[test]
fn default_policy_is_open_and_no_pending() {
    let f = Fixture::new();
    let state = f.client().get_state();
    assert!(!state.policy.require_all_sigs);
    assert!(state.policy.daily_limit.is_none());
    assert_eq!(state.policy.protected_envelopes.len(), 0);
    assert_eq!(state.pending.len(), 0);
}

#[test]
fn set_policy_persists() {
    let f = Fixture::funded();
    let policy = SpendPolicy {
        require_all_sigs: false,
        daily_limit: Some(5 * STROOPS_PER_TOKEN),
        protected_envelopes: vec![&f.env, Envelope::Tuition],
    };
    f.client().set_policy(&policy);

    let state = f.client().get_state();
    assert_eq!(state.policy.daily_limit, Some(5 * STROOPS_PER_TOKEN));
    assert!(state.policy.protected_envelopes.contains(Envelope::Tuition));
}

#[test]
fn spend_routes_to_pending_when_require_all_sigs() {
    let f = Fixture::funded();
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(10 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "approval please"),
    );

    let state = f.client().get_state();
    // Envelope balance untouched — no transfer happened.
    assert_eq!(state.balances.get(0).unwrap(), 50 * STROOPS_PER_TOKEN);
    // Pending request stored.
    assert_eq!(state.pending.len(), 1);
    let req = state.pending.get(0).unwrap();
    assert_eq!(req.amount, 10 * STROOPS_PER_TOKEN);
    assert_eq!(req.caller, f.admin);
}

#[test]
fn spend_routes_to_pending_when_envelope_protected() {
    let f = Fixture::funded();
    f.client().set_policy(&SpendPolicy {
        protected_envelopes: vec![&f.env, Envelope::Tuition],
        ..f.empty_policy()
    });

    // Groceries — not protected — executes immediately.
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "open"),
    );
    // Tuition — protected — queues pending.
    f.client().spend(
        &f.admin,
        &Envelope::Tuition,
        &(5 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "needs approval"),
    );

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 45 * STROOPS_PER_TOKEN); // groceries dropped
    assert_eq!(state.balances.get(1).unwrap(), 30 * STROOPS_PER_TOKEN); // tuition unchanged
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending.get(0).unwrap().envelope, Envelope::Tuition);
}

#[test]
fn spend_routes_to_pending_when_daily_limit_exceeded() {
    let f = Fixture::funded();
    f.client().set_policy(&SpendPolicy {
        daily_limit: Some(5 * STROOPS_PER_TOKEN),
        ..f.empty_policy()
    });

    // First spend (3) is under the limit — executes.
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(3 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "first"),
    );
    // Second spend (3 more) would bring daily to 6 > 5 → pending.
    f.client().spend(
        &f.admin,
        &Envelope::Groceries,
        &(3 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "exceeds limit"),
    );

    let state = f.client().get_state();
    assert_eq!(state.balances.get(0).unwrap(), 47 * STROOPS_PER_TOKEN); // -3 from first
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending.get(0).unwrap().amount, 3 * STROOPS_PER_TOKEN);
}

#[test]
fn approve_request_executes_transfer() {
    let f = Fixture::funded();
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

    f.client().spend(
        &f.admin,
        &Envelope::Tuition,
        &(7 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "school"),
    );

    let pending = f.client().get_state().pending;
    assert_eq!(pending.len(), 1);
    let req_id = pending.get(0).unwrap().id;

    let admin_token_balance_before = f.token().balance(&f.admin);
    f.client().approve_request(&req_id);

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    // Tuition balance dropped, admin received the tokens back.
    assert_eq!(state.balances.get(1).unwrap(), 23 * STROOPS_PER_TOKEN); // 30 - 7
    assert_eq!(
        f.token().balance(&f.admin),
        admin_token_balance_before + 7 * STROOPS_PER_TOKEN,
    );
}

#[test]
fn deny_request_drops_without_transfer() {
    let f = Fixture::funded();
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

    f.client().spend(
        &f.admin,
        &Envelope::Savings,
        &(4 * STROOPS_PER_TOKEN),
        &String::from_str(&f.env, "discretionary"),
    );

    let req_id = f.client().get_state().pending.get(0).unwrap().id;
    let admin_token_before = f.token().balance(&f.admin);

    f.client().deny_request(&req_id);

    let state = f.client().get_state();
    assert_eq!(state.pending.len(), 0);
    // Savings balance unchanged, no tokens moved to admin.
    assert_eq!(state.balances.get(2).unwrap(), 20 * STROOPS_PER_TOKEN);
    assert_eq!(f.token().balance(&f.admin), admin_token_before);
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
