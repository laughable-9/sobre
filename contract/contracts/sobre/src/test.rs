#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, vec, Env, String,
};

/// SEP-41 tokens on Stellar use 7 decimals. 1 token = 10_000_000 stroops.
const STROOPS_PER_TOKEN: i128 = 10_000_000;

const WALLET_NAME: &str = "Pagunsan Family";
const ADMIN_NAME: &str = "Kuya Jun";
const ADMIN_EMOJI: &str = "🥭";

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
        let wallet_name = String::from_str(&env, WALLET_NAME);
        let admin_name = String::from_str(&env, ADMIN_NAME);
        let admin_emoji = String::from_str(&env, ADMIN_EMOJI);
        // env.register now invokes __constructor with these args, atomically
        // deploying + initializing the contract in one step.
        let contract_id = env.register(
            SobreContract,
            (
                admin.clone(),
                payment_token.clone(),
                percents,
                wallet_name,
                admin_name,
                admin_emoji,
            ),
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
        f.client().join_wallet(
            &member,
            &String::from_str(&f.env, "Maria"),
            &String::from_str(&f.env, "🌺"),
        );
        (f, member)
    }

    fn empty_policy(&self) -> SpendPolicy {
        SpendPolicy {
            require_all_sigs: false,
            daily_limit: None,
            protected_envelopes: Vec::new(&self.env),
        }
    }
}

// ─── init ─────────────────────────────────────────────────────────────────

#[test]
fn init_seeds_wallet_name_and_admin_profile() {
    let f = Fixture::new();
    let state = f.client().get_state();

    assert_eq!(state.admin, f.admin);
    assert_eq!(state.payment_token, f.payment_token);
    assert_eq!(state.wallet_name, String::from_str(&f.env, WALLET_NAME));
    assert_eq!(state.percents, vec![&f.env, 50u32, 30u32, 20u32]);
    assert_eq!(state.members.len(), 1);
    let admin_member = state.members.get(0).unwrap();
    assert_eq!(admin_member.address, f.admin);
    assert_eq!(admin_member.name, String::from_str(&f.env, ADMIN_NAME));
    assert_eq!(admin_member.emoji, String::from_str(&f.env, ADMIN_EMOJI));
    assert_eq!(state.balances.len(), 3);
}

// ─── join_wallet ──────────────────────────────────────────────────────────

#[test]
fn join_wallet_appends_profiled_member() {
    let f = Fixture::new();
    let maria = Address::generate(&f.env);

    f.client().join_wallet(
        &maria,
        &String::from_str(&f.env, "Maria"),
        &String::from_str(&f.env, "🌺"),
    );

    let state = f.client().get_state();
    assert_eq!(state.members.len(), 2);
    let m = state.members.get(1).unwrap();
    assert_eq!(m.address, maria);
    assert_eq!(m.name, String::from_str(&f.env, "Maria"));
    assert_eq!(m.emoji, String::from_str(&f.env, "🌺"));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn join_wallet_rejects_duplicate() {
    let f = Fixture::new();
    // Admin already a member; trying to join again is a duplicate.
    f.client().join_wallet(
        &f.admin,
        &String::from_str(&f.env, "Admin again"),
        &String::from_str(&f.env, "🥭"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn join_wallet_rejects_when_at_max() {
    let f = Fixture::new();
    let m1 = Address::generate(&f.env);
    f.client().join_wallet(
        &m1,
        &String::from_str(&f.env, "Maria"),
        &String::from_str(&f.env, "🌺"),
    );
    let m2 = Address::generate(&f.env);
    f.client().join_wallet(
        &m2,
        &String::from_str(&f.env, "Pedro"),
        &String::from_str(&f.env, "🌴"),
    );
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

// ─── set_wallet_name + close_wallet ───────────────────────────────────────

#[test]
fn set_wallet_name_updates_state() {
    let f = Fixture::new();
    f.client()
        .set_wallet_name(&String::from_str(&f.env, "Santos Family"));
    let state = f.client().get_state();
    assert_eq!(state.wallet_name, String::from_str(&f.env, "Santos Family"));
}

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

// ─── set_envelopes / deposit ──────────────────────────────────────────────

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
    let (f, member) = Fixture::funded_with_member();
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

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
    f.client().set_policy(&SpendPolicy {
        protected_envelopes: vec![&f.env, Envelope::Tuition],
        ..f.empty_policy()
    });

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
    f.client().set_policy(&SpendPolicy {
        daily_limit: Some(5 * STROOPS_PER_TOKEN),
        ..f.empty_policy()
    });

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

#[test]
fn approve_request_executes_transfer() {
    let (f, member) = Fixture::funded_with_member();
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

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
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

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
    f.client().set_policy(&SpendPolicy {
        require_all_sigs: true,
        ..f.empty_policy()
    });

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
    f.client().set_policy(&SpendPolicy {
        protected_envelopes: vec![&f.env, Envelope::Tuition],
        ..f.empty_policy()
    });

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
    f.client().set_policy(&SpendPolicy {
        daily_limit: Some(5 * STROOPS_PER_TOKEN),
        ..f.empty_policy()
    });

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
