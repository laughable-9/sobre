#![no_std]
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, vec, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
};

use blend_contract_sdk::pool::{self, Request as PoolRequest};

const MAX_MEMBERS: u32 = 2;
const MAX_SUBACCOUNTS: u32 = 4;

/// Blend v2 non-collateral supply request. bTokens are minted; no collateral
/// factor, no borrow surface. Grow only ever supplies with this request type.
const REQUEST_TYPE_SUPPLY: u32 = 0;
/// Blend v2 non-collateral withdraw. Burns bTokens, transfers underlying back
/// to `to`. Pairs with REQUEST_TYPE_SUPPLY — never mix Supply + Collateral in
/// the same reserve because they mint different position types.
const REQUEST_TYPE_WITHDRAW: u32 = 1;

/// Blend's b_rate is a 12-decimal fixed-point ratio of underlying-per-bToken.
/// underlying = b_tokens * b_rate / SCALAR_12.
const SCALAR_12: i128 = 1_000_000_000_000;

/// 48 hours in seconds. Wall-clock delay from `request_grow_withdrawal`
/// to the earliest `execute_grow_withdrawal` that won't panic.
const GROW_TIMELOCK_SECS: u64 = 48 * 3600;

/// TTL floor for the persistent `GrowRequests` entry — bump on write to
/// this many ledgers (~72h at 5s/ledger). The 48h timelock plus a 24h
/// buffer so a request that lands right before the ledger's TTL sweep
/// doesn't archive out from under the requester.
const GROW_REQ_TTL_LEDGERS: u32 = 51_840;
/// Threshold below which `extend_ttl` actually extends. Set to 34_560
/// (~48h at 5s/ledger) so a re-write within 24h of the last extend
/// short-circuits the host-side TTL syscall instead of doing a no-op bump.
const GROW_REQ_TTL_THRESHOLD: u32 = 34_560;

/// Soroswap swap deadline offset. Every swap sub-invocation carries this
/// many seconds past the current ledger timestamp as its deadline — enough
/// slack for slow ledger closes, tight enough that a stalled request
/// doesn't execute at a stale price when it eventually lands.
const SWAP_DEADLINE_SECS: u64 = 5 * 60;

// ─── Cross-contract clients (Soroswap router, MockUSDY-shaped token) ───────

/// Minimal Soroswap router client. Swap entries + view helpers, plus
/// `router_pair_for` — the pair address is what the router actually
/// pulls the input token to on a swap, so pre-authorizing the SAC
/// transfer requires resolving it first.
#[contractclient(name = "SoroswapRouterClient")]
pub trait SoroswapRouter {
    fn swap_exact_tokens_for_tokens(
        env: Env,
        amount_in: i128,
        amount_out_min: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;

    fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;

    fn router_get_amounts_in(env: Env, amount_out: i128, path: Vec<Address>) -> Vec<i128>;

    fn router_get_amounts_out(env: Env, amount_in: i128, path: Vec<Address>) -> Vec<i128>;

    fn router_pair_for(env: Env, token_a: Address, token_b: Address) -> Address;
}

/// USDY token surface Sobre calls. Interface is intentionally the shape
/// Ondo's real USDY exposes on the chains it currently ships to — so the
/// testnet MockUSDY / mainnet real-USDY swap is a single address change.
#[contractclient(name = "UsdyTokenClient")]
pub trait UsdyToken {
    fn deposit(env: Env, from: Address, amount: i128);
    fn redeem(env: Env, from: Address, amount: i128);
    fn balance_of(env: Env, owner: Address) -> i128;
    fn underlying(env: Env) -> Address;
}

// ─── Domain types ─────────────────────────────────────────────────────────

/// Variant order is wire contract: the `balances` Vec<i128> is indexed
/// [Groceries, Tuition, Savings]. Reordering would silently break every
/// dashboard reading deployed contracts.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Envelope {
    Groceries,
    Tuition,
    Savings,
}

impl Envelope {
    fn index(self) -> u32 {
        match self {
            Envelope::Groceries => 0,
            Envelope::Tuition => 1,
            Envelope::Savings => 2,
        }
    }
}

/// On-chain a member is just an address. Display + role + family rules
/// (split percents, policy, thresholds, daily limits) all live in Supabase.
/// The contract only cares which addresses are authorized to withdraw.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Member {
    pub address: Address,
}

/// Supplementary-card holder. A separate identity tier from `Member`:
/// sub-accounts can only withdraw from their own `balance` (not envelopes),
/// admin tops them up from any envelope via `fund_subaccount`, and admin can
/// flip `locked` to freeze withdrawals instantly. Token custody stays with the
/// contract; this is an internal ledger entry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubAccount {
    pub address: Address,
    pub balance: i128,
    pub locked: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Members,
    Balances,
    /// Address of the SobreFactory that deployed this instance. Read on
    /// `upgrade()` so the admin can opt into the factory's current wasm hash
    /// without having to remember it themselves.
    Factory,
    /// Invite token hash → expires_at_ledger. Key is `sha256(plaintext_token)`
    /// so a passive Soroban indexer can't read the storage entry and redeem
    /// the invite before the legitimate recipient. Deleted by `join_wallet`
    /// on redemption — single-use by construction.
    Invite(BytesN<32>),
    /// Vec<SubAccount> for this family. Distinct from Members so the 2-member
    /// cap stays untouched. Sub-accounts have their own MAX_SUBACCOUNTS cap.
    SubAccounts,
    /// Sub-account invite hash. Parallel to `Invite` but routed through
    /// `join_as_subaccount` so a redeemed token can only ever create a
    /// sub-account, never a member.
    SubAccountInvite(BytesN<32>),

    // ── Earn (USDY) ──
    /// Whether admin has opted this wallet into USDY-yielded Earn. Absent
    /// key defaults to false so pre-upgrade instances read as disabled.
    EarnEnabled,
    /// Address of the USDY-shaped token contract Sobre deposits into for
    /// Earn (MockUSDY on testnet, Ondo's real USDY once it ships on Stellar).
    /// Pinned at `earn_enable` so a token migration doesn't invalidate the
    /// wallet's tracked positions.
    EarnUsdyContract,
    /// Per-envelope USDC-stroops principal deposited into USDY, monotonic-
    /// increasing on supply and decreasing on withdraw. Not the same as the
    /// current USDY balance (which appreciates over time) — see
    /// EarnUsdySupplied/Withdrawn totals below for the accounting basis.
    EarnUsdyPrincipal(Envelope),
    /// Monotonic cumulative USDC stroops supplied to USDY under this
    /// envelope's attribution, across the wallet's lifetime. Never decreases.
    /// Used with EarnUsdyWithdrawn to derive `interest_earned = current_usdy
    /// + withdrawn - supplied` for the dashboard.
    EarnUsdySupplied(Envelope),
    /// Monotonic cumulative USDC stroops withdrawn from USDY under this
    /// envelope's attribution. Never decreases. Interest formula above.
    EarnUsdyWithdrawn(Envelope),

    // ── Grow (Blend XLM reserve + Soroswap sandwich) ──
    /// Whether admin has opted this wallet into the Grow bucket. Absent key
    /// defaults to false so pre-upgrade instances read as disabled.
    GrowEnabled,
    /// USDC-stroops idle in the Grow bucket — funds that arrived via
    /// `grow_transfer_from_savings` but haven't been supplied to Blend yet.
    /// Normal steady-state is 0 (transfer immediately supplies); this exists
    /// as a safety net if a supply mid-flow fails and leaves USDC parked.
    GrowBalance,
    /// Blend v2 pool address the Grow bucket supplies XLM into. Pinned at
    /// `grow_enable`; a pool migration would leave existing bTokens stranded.
    GrowPoolId,
    /// XLM SAC address (Blend's XLM reserve underlying). Also serves as the
    /// intermediate hop when Soroswap-swapping USDC into and out of Grow.
    GrowXlmAsset,
    /// Soroswap router address used for the USDC↔XLM swap sandwich. Pinned
    /// at `grow_enable` for the same reason as `GrowPoolId`.
    GrowSoroswapRouter,
    /// Grow's aggregate bToken position on `GrowPoolId`'s XLM reserve.
    /// Underlying XLM = this * b_rate / SCALAR_12.
    GrowBTokens,
    /// Monotonic cumulative USDC stroops routed into Grow via
    /// `grow_transfer_from_savings`. Never decreases. Used with
    /// `GrowWithdrawnUsdcTotal` to derive Grow's interest-earned display.
    GrowSuppliedUsdcTotal,
    /// Monotonic cumulative USDC stroops paid out of Grow via
    /// `execute_grow_withdrawal`. Never decreases. Interest formula above.
    GrowWithdrawnUsdcTotal,
    /// Monotonic counter used to derive a unique request id for every
    /// `request_grow_withdrawal`. Absent key defaults to 0. Never resets so
    /// the audit log has stable external identifiers.
    NextGrowReqId,
    /// Vec of active grow-withdraw requests. Single persistent entry so one
    /// TTL bump covers every pending timelock. Order is insertion order.
    GrowRequests,
}

#[contracttype]
#[derive(Clone)]
pub struct WalletState {
    pub admin: Address,
    pub payment_token: Address,
    pub members: Vec<Member>,
    pub balances: Vec<i128>,
    pub subaccounts: Vec<SubAccount>,
    /// Empty when the wallet hasn't opted into Earn. Otherwise a one-element
    /// vec carrying the USDY contract + per-envelope positions. Vec-of-one
    /// is the wire shape for optional here: `contracttype` doesn't auto-
    /// derive `Option<T>` XDR conversion for our own struct types (SDK 25).
    pub earn: Vec<EarnState>,
    /// USDC-equivalent value of the Grow bucket at the current Soroswap
    /// XLM/USDC quote. Sum of `GrowBalance` (idle USDC) plus what
    /// `GrowBTokens * b_rate` XLM would swap for on Soroswap right now.
    pub grow_balance: i128,
    /// Whether the wallet has opted into Grow. Distinct from
    /// `grow_balance > 0` because a wallet can be enabled with an empty
    /// bucket (initial state after `grow_enable`).
    pub grow_enabled: bool,
    /// Monotonic cumulative USDC stroops the wallet has ever routed
    /// into Grow via `grow_transfer_from_savings`. Frontend derives
    /// interest_earned = grow_balance + withdrawn_total - supplied_total.
    pub grow_supplied_total: i128,
    /// Monotonic cumulative USDC stroops the wallet has ever paid out
    /// of Grow via `execute_grow_withdrawal`. Frontend derives interest
    /// with the formula above.
    pub grow_withdrawn_total: i128,
    /// Active grow-withdraw requests, insertion order. Frontend renders
    /// per-request countdowns from `unlock_at - now`. Empty when no
    /// request is pending.
    pub grow_requests: Vec<GrowWithdrawRequest>,
}

/// Only present when Earn is enabled. `positions` includes an entry per
/// envelope that currently holds a non-zero USDY principal; empty vec means
/// enabled-but-no-supply-yet.
#[contracttype]
#[derive(Clone)]
pub struct EarnState {
    pub usdy_contract: Address,
    pub positions: Vec<EarnPosition>,
}

/// A single envelope's USDY position. `current_value` is the yield-inclusive
/// balance read live from the USDY contract at get_state time — the
/// appreciation Sobre wants to display on every dashboard poll.
#[contracttype]
#[derive(Clone)]
pub struct EarnPosition {
    pub envelope: Envelope,
    /// USDC stroops originally deposited into USDY under this envelope,
    /// net of prior withdrawals. Baseline for interest calculation.
    pub principal: i128,
    /// Current USDY balance for this envelope (yield-inclusive), USDC
    /// stroops. Grows over time even without a write.
    pub current_value: i128,
    /// Monotonic supplied total for this envelope. Cumulative deposits
    /// across the wallet's lifetime; never decreases.
    pub supplied_total: i128,
    /// Monotonic withdrawn total for this envelope. Cumulative redemptions
    /// across the wallet's lifetime; never decreases.
    pub withdrawn_total: i128,
    /// Realized + unrealized interest: current_value + withdrawn - supplied.
    /// Non-negative under normal USDY appreciation.
    pub interest_earned: i128,
}

/// Grow-withdrawal request. Vec of these lives at `DataKey::GrowRequests`.
/// `unlock_at` is a unix-seconds timestamp (from `env.ledger().timestamp()`
/// at request time + GROW_TIMELOCK_SECS). `execute_grow_withdrawal` traps
/// before that timestamp; `cancel_grow_withdrawal` works anytime the
/// requester chooses to bail out.
#[contracttype]
#[derive(Clone)]
pub struct GrowWithdrawRequest {
    pub id: u64,
    pub requester: Address,
    /// USDC stroops the requester expects to receive on execute. Slippage
    /// during the XLM→USDC swap at execute time uses this as the exact-out
    /// target — Soroswap's `swap_tokens_for_exact_tokens` panics if the
    /// available XLM can't cover this amount.
    pub amount: i128,
    pub unlock_at: u64,
}

/// Emitted by `deposit_with_split`. Topic list: ("Deposit", from). The
/// per-envelope amounts the CALLER passed in are emitted as-is — they were
/// computed off-chain from the family's Supabase-stored split. The chain
/// stores no "agreed split" because admin can change it freely.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Deposit {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub groceries: i128,
    pub tuition: i128,
    pub savings: i128,
}

/// Emitted by `withdraw`. `caller` is the member whose envelope was
/// debited — tokens land in their wallet, ready to be forwarded to
/// PDAX for a bank cashout (the only real off-ramp for OFW families).
#[contractevent]
#[derive(Clone, Debug)]
pub struct Withdraw {
    #[topic]
    pub caller: Address,
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
    pub memo: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteCreated {
    #[topic]
    pub invite_hash: BytesN<32>,
    pub expires_at_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteRedeemed {
    #[topic]
    pub invite_hash: BytesN<32>,
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MemberJoined {
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MemberRemoved {
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletUpgraded {
    pub new_wasm: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WalletClosed {
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountInviteCreated {
    #[topic]
    pub invite_hash: BytesN<32>,
    pub expires_at_ledger: u32,
}

/// Emitted by admin-triggered `cancel_invite` — the plaintext token was
/// lost / mis-shared / socially compromised, so admin nukes the on-chain
/// hash entry to make the invite unredeemable before its natural expiry.
#[contractevent]
#[derive(Clone, Debug)]
pub struct InviteCancelled {
    #[topic]
    pub invite_hash: BytesN<32>,
}

/// Same as `InviteCancelled` for the sub-account invite storage bucket.
/// Kept as a distinct event so indexers can filter "cancelled a member
/// invite" vs "cancelled a supplementary invite" without walking storage.
#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountInviteCancelled {
    #[topic]
    pub invite_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountJoined {
    #[topic]
    pub subaccount: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountFunded {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountWithdraw {
    #[topic]
    pub caller: Address,
    pub amount: i128,
    pub memo: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountLockChanged {
    #[topic]
    pub subaccount: Address,
    pub locked: bool,
}

/// Emitted once per Sobre wallet lifetime by `earn_enable`. Downstream
/// indexers key on this to know when the wallet started earning yield.
#[contractevent]
#[derive(Clone, Debug)]
pub struct EarnEnabledEvent {
    #[topic]
    pub usdy_contract: Address,
}

/// Emitted by `earn_supply`. `amount` is USDC-stroops principal supplied to
/// USDY under this envelope's attribution.
#[contractevent]
#[derive(Clone, Debug)]
pub struct EarnSupply {
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
}

/// Emitted by `earn_withdraw`. `amount` is USDC-stroops principal
/// redeemed back into this envelope's cache.
#[contractevent]
#[derive(Clone, Debug)]
pub struct EarnWithdraw {
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
}

/// Emitted once per Sobre wallet lifetime by `grow_enable`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowEnabledEvent {
    #[topic]
    pub pool: Address,
    #[topic]
    pub xlm_asset: Address,
    pub soroswap_router: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowTransfer {
    /// USDC stroops moved from Savings envelope into the Grow bucket.
    pub amount: i128,
    /// XLM stroops actually supplied to Blend after the Soroswap swap.
    /// Debug-friendly: pair with `amount` to compute the effective rate.
    pub xlm_supplied: i128,
}

/// Emitted by `request_grow_withdrawal`. `amount` is USDC stroops the
/// requester will receive on execute (subject to the timelock).
#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowRequest {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub requester: Address,
    pub amount: i128,
    pub unlock_at: u64,
}

/// Emitted by `execute_grow_withdrawal`. `amount` is USDC delivered to
/// requester; `xlm_withdrawn` is what came out of Blend before the swap
/// (audit trail for the effective Soroswap rate on this execution).
#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowExecute {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub requester: Address,
    pub amount: i128,
    pub xlm_withdrawn: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowCancel {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub requester: Address,
    pub amount: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 6,
    DuplicateMember = 4,
    MemberLimitReached = 5,
    NotAMember = 7,
    InsufficientBalance = 8,
    MemberNotFound = 10,
    CannotRemoveAdmin = 11,
    InviteNotFound = 13,
    InviteExpired = 14,
    SubAccountNotFound = 15,
    SubAccountLocked = 16,
    DuplicateSubAccount = 17,
    SubAccountLimitReached = 18,
    EarnAlreadyEnabled = 19,
    EarnNotEnabled = 20,
    EarnInsufficientPosition = 21,
    GrowAlreadyEnabled = 22,
    GrowNotEnabled = 23,
    GrowRequestNotFound = 24,
    GrowTimelockNotElapsed = 25,
}

// ─── Private helpers ──────────────────────────────────────────────────────

fn init_inner(env: Env, admin: Address, payment_token: Address, factory: Address) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(&env, Error::AlreadyInitialized);
    }
    let inst = env.storage().instance();
    inst.set(&DataKey::Admin, &admin);
    inst.set(&DataKey::PaymentToken, &payment_token);
    inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
    inst.set(&DataKey::Factory, &factory);
    let admin_member = Member { address: admin };
    inst.set(&DataKey::Members, &vec![&env, admin_member]);
}

fn require_admin_auth(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    admin.require_auth();
}

fn find_member_index(members: &Vec<Member>, addr: &Address) -> Option<u32> {
    for (i, m) in members.iter().enumerate() {
        if &m.address == addr {
            return Some(i as u32);
        }
    }
    None
}

fn find_subaccount_index(subs: &Vec<SubAccount>, addr: &Address) -> Option<u32> {
    for (i, s) in subs.iter().enumerate() {
        if &s.address == addr {
            return Some(i as u32);
        }
    }
    None
}

fn load_subaccounts(env: &Env) -> Vec<SubAccount> {
    env.storage()
        .instance()
        .get(&DataKey::SubAccounts)
        .unwrap_or_else(|| Vec::new(env))
}

fn set_subaccount_lock(env: &Env, subaccount: &Address, locked: bool) {
    require_admin_auth(env);
    let inst = env.storage().instance();
    let mut subs = load_subaccounts(env);
    let idx = find_subaccount_index(&subs, subaccount)
        .unwrap_or_else(|| panic_with_error!(env, Error::SubAccountNotFound));
    let mut sub = subs.get(idx).unwrap();
    if sub.locked == locked {
        return;
    }
    sub.locked = locked;
    subs.set(idx, sub);
    inst.set(&DataKey::SubAccounts, &subs);
    SubAccountLockChanged {
        subaccount: subaccount.clone(),
        locked,
    }
    .publish(env);
}

fn require_member(env: &Env, addr: &Address) {
    let members: Vec<Member> = env.storage().instance().get(&DataKey::Members).unwrap();
    if find_member_index(&members, addr).is_none() {
        panic_with_error!(env, Error::NotAMember);
    }
}

fn is_earn_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::EarnEnabled)
        .unwrap_or(false)
}

fn load_usdy_contract(env: &Env) -> Address {
    let inst = env.storage().instance();
    if !inst.get::<_, bool>(&DataKey::EarnEnabled).unwrap_or(false) {
        panic_with_error!(env, Error::EarnNotEnabled);
    }
    inst.get(&DataKey::EarnUsdyContract).unwrap()
}

/// Pre-authorizes a `token.transfer(self → target, amount)` sub-invocation
/// so a downstream contract (USDY, Blend pool, Soroswap router) can pull
/// the underlying from Sobre. Without this the SAC's own `require_auth`
/// under the sub-call would trap. Uses `env.authorize_as_current_contract`
/// which is the only way for a contract to sign transfer approvals from
/// its own address without a real signature.
fn authorize_token_pull(env: &Env, token_addr: &Address, target: &Address, amount: i128) {
    let self_addr = env.current_contract_address();
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token_addr.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (self_addr, target.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);
}

/// Deposits `usdc_amount` USDC stroops into MockUSDY under this envelope's
/// attribution. Updates `EarnUsdyPrincipal(envelope)` and `EarnUsdySupplied
/// (envelope)`. Assumes caller has already verified the source has the
/// stroops available.
fn do_usdy_deposit(env: &Env, envelope: Envelope, usdc_amount: i128) {
    let inst = env.storage().instance();
    let usdy = load_usdy_contract(env);
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    // Pre-authorize USDY's inner `token.transfer(self → usdy, amount)` pull.
    authorize_token_pull(env, &payment_token, &usdy, usdc_amount);
    UsdyTokenClient::new(env, &usdy).deposit(&env.current_contract_address(), &usdc_amount);
    let principal_key = DataKey::EarnUsdyPrincipal(envelope);
    let prior: i128 = inst.get(&principal_key).unwrap_or(0);
    inst.set(&principal_key, &(prior + usdc_amount));
    let supplied_key = DataKey::EarnUsdySupplied(envelope);
    let prior_supplied: i128 = inst.get(&supplied_key).unwrap_or(0);
    inst.set(&supplied_key, &(prior_supplied + usdc_amount));
}

/// Redeems `usdc_amount` USDC stroops from MockUSDY under this envelope's
/// attribution. Updates `EarnUsdyPrincipal(envelope)` and
/// `EarnUsdyWithdrawn(envelope)`. Panics with `EarnInsufficientPosition`
/// if the envelope's principal can't cover the request — a Savings redeem
/// must not drain a sibling envelope's stake.
fn do_usdy_redeem(env: &Env, envelope: Envelope, usdc_amount: i128) {
    let inst = env.storage().instance();
    let usdy = load_usdy_contract(env);
    let principal_key = DataKey::EarnUsdyPrincipal(envelope);
    let prior_principal: i128 = inst.get(&principal_key).unwrap_or(0);
    if prior_principal < usdc_amount {
        panic_with_error!(env, Error::EarnInsufficientPosition);
    }
    UsdyTokenClient::new(env, &usdy).redeem(&env.current_contract_address(), &usdc_amount);
    inst.set(&principal_key, &(prior_principal - usdc_amount));
    let withdrawn_key = DataKey::EarnUsdyWithdrawn(envelope);
    let prior_withdrawn: i128 = inst.get(&withdrawn_key).unwrap_or(0);
    inst.set(&withdrawn_key, &(prior_withdrawn + usdc_amount));
}

/// Attributes the contract-wide USDY balance to an envelope by its
/// principal share. Sobre's USDY position is single-account at the token
/// level (deposit is keyed on `env.current_contract_address()`), so this
/// fair-share formula sits in the reader:
///   current_env = usdy_total * principal_env / principal_all
///
/// Caller passes the envelope's own principal (already read for other
/// bookkeeping) so this doesn't repeat the storage hit inside a loop.
fn current_usdy_value(usdy_total: i128, principal_env: i128, principal_all: i128) -> i128 {
    if principal_all <= 0 || usdy_total <= 0 || principal_env <= 0 {
        return 0;
    }
    (usdy_total * principal_env) / principal_all
}

fn sum_usdy_principal(env: &Env) -> i128 {
    let inst = env.storage().instance();
    ENVELOPES.iter().fold(0i128, |acc, e| {
        acc + inst
            .get::<_, i128>(&DataKey::EarnUsdyPrincipal(*e))
            .unwrap_or(0)
    })
}

const ENVELOPES: [Envelope; 3] = [Envelope::Groceries, Envelope::Tuition, Envelope::Savings];

/// Ensures `Balances[envelope]` has at least `amount` stroops available.
/// When Earn is enabled and the envelope's cache is short, auto-redeems
/// the shortfall from USDY for that envelope's attribution and credits
/// the cache. Returns the balances vec (mutated in-place so callers can
/// do their own debit and one `inst.set` on the way out).
///
/// This is the "transparent Earn" magic — withdrawers/subaccount-funders
/// never call `earn_withdraw` themselves; they just call `withdraw` and this
/// helper handles the USDY redeem in the same tx.
fn ensure_envelope_liquidity(env: &Env, envelope: Envelope, amount: i128) -> Vec<i128> {
    let inst = env.storage().instance();
    let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
    let idx = envelope.index();
    let current = balances.get(idx).unwrap();
    if current >= amount || !is_earn_enabled(env) {
        // Either the cache covers the ask or there's no USDY fallback to
        // reach for — either way, let the caller run its normal balance
        // check (which will pass or InsufficientBalance-panic).
        return balances;
    }
    let shortfall = amount - current;
    do_usdy_redeem(env, envelope, shortfall);
    balances.set(idx, current + shortfall);
    inst.set(&DataKey::Balances, &balances);
    balances
}

/// True when Grow has been configured with pool + asset + router.
fn is_grow_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::GrowEnabled)
        .unwrap_or(false)
}

fn require_grow_enabled(env: &Env) {
    if !is_grow_enabled(env) {
        panic_with_error!(env, Error::GrowNotEnabled);
    }
}

/// Blend Grow bTokens → underlying XLM stroops at the current pool b_rate.
/// One cross-contract `get_reserve` read; safe for view paths.
fn grow_underlying_xlm(env: &Env, b_tokens: i128) -> i128 {
    if b_tokens <= 0 {
        return 0;
    }
    let inst = env.storage().instance();
    let pool_id: Address = inst.get(&DataKey::GrowPoolId).unwrap();
    let asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let b_rate = pool::Client::new(env, &pool_id)
        .get_reserve(&asset)
        .data
        .b_rate;
    (b_tokens * b_rate) / SCALAR_12
}

/// Grow's total value as USDC stroops — sum of the idle `GrowBalance`
/// cache plus the current Soroswap quote for the underlying XLM's
/// bTokens-in-Blend value.
///
/// Both legs read live-price data (`get_reserve` for Blend b_rate,
/// `router_get_amounts_out` for Soroswap rate). Fine for view paths;
/// preflight-cost-only.
fn grow_total_value_usdc(env: &Env) -> i128 {
    let inst = env.storage().instance();
    let cache: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
    let b: i128 = inst.get(&DataKey::GrowBTokens).unwrap_or(0);
    if b <= 0 {
        return cache;
    }
    let underlying_xlm = grow_underlying_xlm(env, b);
    if underlying_xlm <= 0 {
        return cache;
    }
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    let xlm_asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let router: Address = inst.get(&DataKey::GrowSoroswapRouter).unwrap();
    let path: Vec<Address> = vec![env, xlm_asset, payment_token];
    let amounts =
        SoroswapRouterClient::new(env, &router).router_get_amounts_out(&underlying_xlm, &path);
    let usdc_out = amounts.get(amounts.len() - 1).unwrap_or(0);
    cache + usdc_out
}

/// Supplies `xlm_amount` XLM stroops to Blend under Grow's attribution.
/// Assumes the contract already holds `xlm_amount` XLM stroops (from a
/// prior Soroswap swap-in). Bumps `GrowBTokens`. Returns the bToken delta
/// so callers can emit auditable events. Pool address + asset are pinned
/// at `grow_enable` — no per-call params.
fn do_grow_blend_supply(env: &Env, xlm_amount: i128) -> i128 {
    let inst = env.storage().instance();
    let pool_id: Address = inst.get(&DataKey::GrowPoolId).unwrap();
    let asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let self_addr = env.current_contract_address();
    let pool_client = pool::Client::new(env, &pool_id);
    let reserve_index = pool_client.get_reserve(&asset).config.index;
    authorize_token_pull(env, &asset, &pool_id, xlm_amount);
    let prior: i128 = inst.get(&DataKey::GrowBTokens).unwrap_or(0);
    let requests: Vec<PoolRequest> = vec![
        env,
        PoolRequest {
            request_type: REQUEST_TYPE_SUPPLY,
            address: asset,
            amount: xlm_amount,
        },
    ];
    let positions = pool_client.submit(&self_addr, &self_addr, &self_addr, &requests);
    let new_total: i128 = positions.supply.get(reserve_index).unwrap_or(0);
    let delta = new_total - prior;
    inst.set(&DataKey::GrowBTokens, &new_total);
    delta
}

/// Withdraws `xlm_amount` XLM stroops from Blend for Grow. Bumps
/// `GrowBTokens` down by the burned bToken delta.
fn do_grow_blend_withdraw(env: &Env, xlm_amount: i128) {
    let inst = env.storage().instance();
    let pool_id: Address = inst.get(&DataKey::GrowPoolId).unwrap();
    let asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let self_addr = env.current_contract_address();
    let pool_client = pool::Client::new(env, &pool_id);
    let reserve_index = pool_client.get_reserve(&asset).config.index;
    let prior_b: i128 = inst.get(&DataKey::GrowBTokens).unwrap_or(0);
    if prior_b <= 0 {
        panic_with_error!(env, Error::EarnInsufficientPosition);
    }
    let requests: Vec<PoolRequest> = vec![
        env,
        PoolRequest {
            request_type: REQUEST_TYPE_WITHDRAW,
            address: asset,
            amount: xlm_amount,
        },
    ];
    let positions = pool_client.submit(&self_addr, &self_addr, &self_addr, &requests);
    let new_total: i128 = positions.supply.get(reserve_index).unwrap_or(0);
    if new_total > prior_b {
        // Sanity: Blend should never return more shares than we started with
        // on a withdraw. Guards against wrapper/router upgrade regressions.
        panic_with_error!(env, Error::EarnInsufficientPosition);
    }
    inst.set(&DataKey::GrowBTokens, &new_total);
}

/// Swaps `xlm_in` XLM stroops → USDC stroops via Soroswap, exact-in
/// direction. Mirror of `do_soroswap_swap_usdc_to_xlm` for the reverse
/// leg — used by the PDAX ramp so that Sobre can accept a raw XLM
/// payment from the relay and convert to its USDC payment token in the
/// same call.
fn do_soroswap_swap_xlm_to_usdc(env: &Env, xlm_in: i128) -> i128 {
    let inst = env.storage().instance();
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    let xlm_asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let router: Address = inst.get(&DataKey::GrowSoroswapRouter).unwrap();
    let path: Vec<Address> = vec![env, xlm_asset.clone(), payment_token.clone()];
    let router_client = SoroswapRouterClient::new(env, &router);
    let quoted = router_client.router_get_amounts_out(&xlm_in, &path);
    let expected_out = quoted.get(quoted.len() - 1).unwrap_or(0);
    let min_out = (expected_out * 98) / 100;
    // Pre-auth the token pull with the ACTUAL destination: Soroswap's
    // swap internally does `token.transfer(&to, &pair, amount)`, and the
    // pair is where reserves live (not the router). Authorizing the
    // router as target trips `Error(Auth, InvalidAction)` at submit.
    let pair = router_client.router_pair_for(&xlm_asset, &payment_token);
    authorize_token_pull(env, &xlm_asset, &pair, xlm_in);
    let deadline = env.ledger().timestamp() + SWAP_DEADLINE_SECS;
    let self_addr = env.current_contract_address();
    let received =
        router_client.swap_exact_tokens_for_tokens(&xlm_in, &min_out, &path, &self_addr, &deadline);
    received.get(received.len() - 1).unwrap_or(0)
}

/// Swaps `usdc_in` USDC stroops → XLM stroops via Soroswap, exact-in
/// direction. Pre-authorizes the SAC's `token.transfer(self → pair,
/// usdc_in)` pull. Uses a 2%-below-quote floor as the `amount_out_min`
/// slippage guard.
fn do_soroswap_swap_usdc_to_xlm(env: &Env, usdc_in: i128) -> i128 {
    let inst = env.storage().instance();
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    let xlm_asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let router: Address = inst.get(&DataKey::GrowSoroswapRouter).unwrap();
    let path: Vec<Address> = vec![env, payment_token.clone(), xlm_asset.clone()];
    let router_client = SoroswapRouterClient::new(env, &router);
    let quoted = router_client.router_get_amounts_out(&usdc_in, &path);
    let expected_out = quoted.get(quoted.len() - 1).unwrap_or(0);
    let min_out = (expected_out * 98) / 100;
    let pair = router_client.router_pair_for(&payment_token, &xlm_asset);
    authorize_token_pull(env, &payment_token, &pair, usdc_in);
    let deadline = env.ledger().timestamp() + SWAP_DEADLINE_SECS;
    let self_addr = env.current_contract_address();
    let received =
        router_client.swap_exact_tokens_for_tokens(&usdc_in, &min_out, &path, &self_addr, &deadline);
    received.get(received.len() - 1).unwrap_or(0)
}

/// Swaps XLM stroops → `usdc_out` USDC stroops via Soroswap, exact-out
/// direction. Reads a quote to figure out max XLM the swap would need,
/// then calls swap_tokens_for_exact_tokens with a 2%-slippage-headroom
/// on the input. Pre-authorizes the router's XLM pull. Returns the
/// actual XLM consumed.
fn do_soroswap_swap_xlm_to_usdc_exact_out(env: &Env, usdc_out: i128) -> i128 {
    let inst = env.storage().instance();
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    let xlm_asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
    let router: Address = inst.get(&DataKey::GrowSoroswapRouter).unwrap();
    let path: Vec<Address> = vec![env, xlm_asset.clone(), payment_token.clone()];
    let router_client = SoroswapRouterClient::new(env, &router);
    let quoted = router_client.router_get_amounts_in(&usdc_out, &path);
    let expected_in = quoted.get(0).unwrap_or(0);
    if expected_in <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    // 2% slippage headroom on input side: caller pre-authorizes for up to
    // this many XLM stroops out, router actually pulls `expected_in`. Auth
    // entry has to match the ACTUAL pull amount, so we pre-auth for
    // `expected_in` (from the pre-swap quote) — under the same-tx state
    // guarantee this is exactly what the router will consume. `max_in` is
    // still passed as the router's own slippage guard.
    let max_in = (expected_in * 102) / 100;
    let pair = router_client.router_pair_for(&xlm_asset, &payment_token);
    authorize_token_pull(env, &xlm_asset, &pair, expected_in);
    let deadline = env.ledger().timestamp() + SWAP_DEADLINE_SECS;
    let self_addr = env.current_contract_address();
    let consumed = router_client.swap_tokens_for_exact_tokens(
        &usdc_out,
        &max_in,
        &path,
        &self_addr,
        &deadline,
    );
    consumed.get(0).unwrap_or(0)
}

fn load_grow_requests(env: &Env) -> Vec<GrowWithdrawRequest> {
    env.storage()
        .persistent()
        .get(&DataKey::GrowRequests)
        .unwrap_or_else(|| Vec::new(env))
}

/// Writes the requests vec and bumps its TTL to cover the full 48h wait
/// plus a 24h buffer. When the vec is empty (last request cleared), drop
/// the persistent entry entirely instead of leaving an empty-vec ghost
/// with a fresh TTL bump — reclaims the ledger slot cleanly.
fn store_grow_requests(env: &Env, requests: &Vec<GrowWithdrawRequest>) {
    let key = DataKey::GrowRequests;
    if requests.is_empty() {
        env.storage().persistent().remove(&key);
        return;
    }
    env.storage().persistent().set(&key, requests);
    env.storage()
        .persistent()
        .extend_ttl(&key, GROW_REQ_TTL_THRESHOLD, GROW_REQ_TTL_LEDGERS);
}

fn find_grow_request_index(
    requests: &Vec<GrowWithdrawRequest>,
    id: u64,
) -> Option<u32> {
    for (i, r) in requests.iter().enumerate() {
        if r.id == id {
            return Some(i as u32);
        }
    }
    None
}

/// Used by `withdraw`. Assumes auth + member checks already done.
/// Transfers tokens to `caller`'s wallet, debits the envelope, emits
/// Withdraw with `caller` as the topic. When Earn is enabled and the
/// envelope's cache is short, `ensure_envelope_liquidity` auto-redeems
/// from USDY so the withdraw lands transparently in the same tx.
fn execute_withdraw(env: &Env, caller: &Address, envelope: Envelope, amount: i128, memo: &String) {
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    let inst = env.storage().instance();
    let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
    let mut balances = ensure_envelope_liquidity(env, envelope, amount);
    let index = envelope.index();
    let current = balances.get(index).unwrap();
    if current < amount {
        panic_with_error!(env, Error::InsufficientBalance);
    }
    token::Client::new(env, &payment_token).transfer(
        &env.current_contract_address(),
        caller,
        &amount,
    );
    balances.set(index, current - amount);
    inst.set(&DataKey::Balances, &balances);
    Withdraw {
        caller: caller.clone(),
        envelope,
        amount,
        memo: memo.clone(),
    }
    .publish(env);
}

// ─── Contract ─────────────────────────────────────────────────────────────

#[contract]
pub struct SobreContract;

#[contractimpl]
impl SobreContract {
    /// Auto-invoked on deploy_v2 by SobreFactory.create_sobre. Manual
    /// deploys call `init` directly with the same args.
    pub fn __constructor(env: Env, admin: Address, payment_token: Address, factory: Address) {
        init_inner(env, admin, payment_token, factory);
    }

    pub fn init(env: Env, admin: Address, payment_token: Address, factory: Address) {
        admin.require_auth();
        init_inner(env, admin, payment_token, factory);
    }

    pub fn create_invite(env: Env, token_hash: BytesN<32>, expires_at_ledger: u32) {
        require_admin_auth(&env);
        let now = env.ledger().sequence();
        if expires_at_ledger <= now {
            panic_with_error!(&env, Error::InviteExpired);
        }
        let ttl = expires_at_ledger - now;
        let key = DataKey::Invite(token_hash.clone());
        env.storage().persistent().set(&key, &expires_at_ledger);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);
        InviteCreated {
            invite_hash: token_hash,
            expires_at_ledger,
        }
        .publish(&env);
    }

    /// Admin-only. Removes the on-chain hash entry so the invite can't be
    /// redeemed even if someone still holds the plaintext. Traps if the
    /// hash isn't present (already redeemed or already expired-and-swept
    /// on a prior read).
    pub fn cancel_invite(env: Env, token_hash: BytesN<32>) {
        require_admin_auth(&env);
        let key = DataKey::Invite(token_hash.clone());
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::InviteNotFound);
        }
        env.storage().persistent().remove(&key);
        InviteCancelled {
            invite_hash: token_hash,
        }
        .publish(&env);
    }

    pub fn join_wallet(env: Env, caller: Address, invite_token: BytesN<32>) {
        caller.require_auth();
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::NotInitialized);
        }
        let token_hash: BytesN<32> = env.crypto().sha256(&Bytes::from(invite_token)).into();
        let invite_key = DataKey::Invite(token_hash.clone());
        let expires_at_ledger: u32 = env
            .storage()
            .persistent()
            .get(&invite_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InviteNotFound));
        if env.ledger().sequence() > expires_at_ledger {
            env.storage().persistent().remove(&invite_key);
            panic_with_error!(&env, Error::InviteExpired);
        }
        let inst = env.storage().instance();
        let mut members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        if find_member_index(&members, &caller).is_some() {
            panic_with_error!(&env, Error::DuplicateMember);
        }
        if members.len() >= MAX_MEMBERS {
            panic_with_error!(&env, Error::MemberLimitReached);
        }
        members.push_back(Member {
            address: caller.clone(),
        });
        inst.set(&DataKey::Members, &members);
        env.storage().persistent().remove(&invite_key);
        MemberJoined {
            member: caller.clone(),
        }
        .publish(&env);
        InviteRedeemed {
            invite_hash: token_hash,
            member: caller,
        }
        .publish(&env);
    }

    pub fn remove_member(env: Env, member: Address) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        if member == admin {
            panic_with_error!(&env, Error::CannotRemoveAdmin);
        }
        let mut members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        let idx = find_member_index(&members, &member)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MemberNotFound));
        members.remove(idx);
        inst.set(&DataKey::Members, &members);
        MemberRemoved { member }.publish(&env);
    }

    pub fn close_wallet(env: Env) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();

        // Sweep every envelope's USDY position back into its cache. Uses
        // the fair-share formula so accrued yield on a merged position
        // gets split among envelopes by their principal ratio.
        if is_earn_enabled(&env) {
            let usdy = load_usdy_contract(&env);
            let self_addr = env.current_contract_address();
            let usdy_total = UsdyTokenClient::new(&env, &usdy).balance_of(&self_addr);
            let principal_all = sum_usdy_principal(&env);
            if usdy_total > 0 && principal_all > 0 {
                let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
                let mut wrote_balances = false;
                for e in ENVELOPES.iter() {
                    let principal_env: i128 = inst
                        .get(&DataKey::EarnUsdyPrincipal(*e))
                        .unwrap_or(0);
                    let share = current_usdy_value(usdy_total, principal_env, principal_all);
                    if share <= 0 {
                        continue;
                    }
                    // Redeem the envelope's fair share. The USDY contract's
                    // redemption logic pays out share worth of USDC in one
                    // hit; principal on our side goes to zero.
                    UsdyTokenClient::new(&env, &usdy).redeem(&self_addr, &share);
                    inst.set(&DataKey::EarnUsdyPrincipal(*e), &0i128);
                    let prior_withdrawn: i128 = inst
                        .get(&DataKey::EarnUsdyWithdrawn(*e))
                        .unwrap_or(0);
                    inst.set(
                        &DataKey::EarnUsdyWithdrawn(*e),
                        &(prior_withdrawn + share),
                    );
                    let idx = e.index();
                    balances.set(idx, balances.get(idx).unwrap() + share);
                    wrote_balances = true;
                }
                if wrote_balances {
                    inst.set(&DataKey::Balances, &balances);
                }
            }
        }

        // Sweep the Grow bucket: withdraw Blend XLM if any bTokens remain,
        // swap the resulting XLM back to USDC, add to GrowBalance cache.
        if is_grow_enabled(&env) {
            let b_tokens: i128 = inst.get(&DataKey::GrowBTokens).unwrap_or(0);
            if b_tokens > 0 {
                let xlm_underlying = grow_underlying_xlm(&env, b_tokens);
                if xlm_underlying > 0 {
                    do_grow_blend_withdraw(&env, xlm_underlying);
                    let usdc_received = do_soroswap_swap_xlm_to_usdc(&env, xlm_underlying);
                    let prior: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
                    inst.set(&DataKey::GrowBalance, &(prior + usdc_received));
                }
            }
        }

        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let subs = load_subaccounts(&env);
        let grow_balance: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
        let mut total: i128 = 0;
        for b in balances.iter() {
            total += b;
        }
        // Sub-account balances are internal ledger entries against the same
        // contract-held token pool. Sweep them with envelopes so closing
        // doesn't leak custody.
        for s in subs.iter() {
            total += s.balance;
        }
        total += grow_balance;
        if total > 0 {
            token::Client::new(&env, &payment_token).transfer(
                &env.current_contract_address(),
                &admin,
                &total,
            );
        }
        inst.set(&DataKey::Balances, &vec![&env, 0i128, 0i128, 0i128]);
        inst.set(&DataKey::GrowBalance, &0i128);
        if !subs.is_empty() {
            let mut zeroed: Vec<SubAccount> = Vec::new(&env);
            for s in subs.iter() {
                zeroed.push_back(SubAccount {
                    address: s.address.clone(),
                    balance: 0,
                    locked: s.locked,
                });
            }
            inst.set(&DataKey::SubAccounts, &zeroed);
        }
        WalletClosed { total }.publish(&env);
    }

    pub fn upgrade(env: Env) {
        require_admin_auth(&env);
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::Factory)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let new_wasm: BytesN<32> = env.invoke_contract(
            &factory,
            &soroban_sdk::Symbol::new(&env, "current_sobre_wasm"),
            soroban_sdk::Vec::new(&env),
        );
        env.deployer().update_current_contract_wasm(new_wasm.clone());
        WalletUpgraded { new_wasm }.publish(&env);
    }

    /// Deposit with the per-envelope split already computed off-chain. The
    /// contract pulls (groceries+tuition+savings) tokens via the SAC and
    /// credits each envelope by the amount the caller passed in. The "agreed
    /// split" lives in Supabase — admin can edit it freely without paying
    /// any fee; the next deposit just reflects the latest version.
    pub fn deposit_with_split(
        env: Env,
        from: Address,
        groceries: i128,
        tuition: i128,
        savings: i128,
    ) {
        from.require_auth();
        if groceries < 0 || tuition < 0 || savings < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let total = groceries + tuition + savings;
        if total <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        token::Client::new(&env, &payment_token).transfer(
            &from,
            &env.current_contract_address(),
            &total,
        );
        // Groceries + Tuition always credit the envelope cache directly.
        // Savings routes through USDY when Earn is enabled — the envelope
        // cache stays at its current value (usually 0 post-migration) so
        // withdraw logic uses `ensure_envelope_liquidity` to auto-redeem.
        let earn_on = is_earn_enabled(&env);
        let new_savings_cache = if earn_on && savings > 0 {
            balances.get(2).unwrap()
        } else {
            balances.get(2).unwrap() + savings
        };
        inst.set(
            &DataKey::Balances,
            &vec![
                &env,
                balances.get(0).unwrap() + groceries,
                balances.get(1).unwrap() + tuition,
                new_savings_cache,
            ],
        );
        if earn_on && savings > 0 {
            do_usdy_deposit(&env, Envelope::Savings, savings);
        }
        Deposit {
            from,
            amount: total,
            groceries,
            tuition,
            savings,
        }
        .publish(&env);
    }

    /// PDAX-ramp entry point: the relay G-address delivers raw XLM, the
    /// contract swaps to USDC via Soroswap, then splits by the caller-
    /// specified percentages. Interface takes percentages (0-100 summing
    /// to 100) instead of pre-computed USDC amounts because the server
    /// has no reliable way to know the actual swap payout before the
    /// swap runs — Soroswap's rate is live at execute time. Passing
    /// percentages lets the contract split the ACTUAL payout, so a
    /// pre-quote mismatch can't leave envelopes short.
    ///
    /// Rounding remainder from the integer divisions lands in Savings so
    /// the sum of credited envelopes exactly matches the payout stroops.
    /// Groceries + Tuition credit the cache; Savings routes through
    /// USDY when Earn is enabled.
    pub fn deposit_from_xlm(
        env: Env,
        from: Address,
        xlm_amount: i128,
        groceries_pct: u32,
        tuition_pct: u32,
        savings_pct: u32,
    ) {
        from.require_auth();
        require_grow_enabled(&env);
        if xlm_amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if groceries_pct + tuition_pct + savings_pct != 100 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let xlm_asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
        token::Client::new(&env, &xlm_asset).transfer(
            &from,
            &env.current_contract_address(),
            &xlm_amount,
        );
        let usdc_received = do_soroswap_swap_xlm_to_usdc(&env, xlm_amount);
        if usdc_received <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Split the actual payout by the caller's percentages. Integer
        // math; Savings absorbs the rounding remainder so the sum
        // matches usdc_received exactly.
        let groceries = (usdc_received * (groceries_pct as i128)) / 100;
        let tuition = (usdc_received * (tuition_pct as i128)) / 100;
        let savings = usdc_received - groceries - tuition;

        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let earn_on = is_earn_enabled(&env);
        let new_savings_cache = if earn_on && savings > 0 {
            balances.get(2).unwrap()
        } else {
            balances.get(2).unwrap() + savings
        };
        inst.set(
            &DataKey::Balances,
            &vec![
                &env,
                balances.get(0).unwrap() + groceries,
                balances.get(1).unwrap() + tuition,
                new_savings_cache,
            ],
        );
        if earn_on && savings > 0 {
            do_usdy_deposit(&env, Envelope::Savings, savings);
        }
        Deposit {
            from,
            amount: usdc_received,
            groceries,
            tuition,
            savings,
        }
        .publish(&env);
    }

    /// Member pulls USDC out of an envelope into their own wallet. The
    /// only downstream path is the PDAX cashout flow — this contract
    /// doesn't concern itself with what the wallet does with the funds
    /// after that. Balance check + transfer + emit.
    pub fn withdraw(env: Env, caller: Address, envelope: Envelope, amount: i128, memo: String) {
        caller.require_auth();
        require_member(&env, &caller);
        execute_withdraw(&env, &caller, envelope, amount, &memo);
    }

    /// Admin mints a sub-account invite. Same sha256-of-plaintext shape as
    /// `create_invite` so an indexer reading storage can't grab the token.
    /// Distinct DataKey variant so a member-side invite can never be redeemed
    /// as a sub-account or vice versa.
    pub fn create_subaccount_invite(env: Env, token_hash: BytesN<32>, expires_at_ledger: u32) {
        require_admin_auth(&env);
        let now = env.ledger().sequence();
        if expires_at_ledger <= now {
            panic_with_error!(&env, Error::InviteExpired);
        }
        let ttl = expires_at_ledger - now;
        let key = DataKey::SubAccountInvite(token_hash.clone());
        env.storage().persistent().set(&key, &expires_at_ledger);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);
        SubAccountInviteCreated {
            invite_hash: token_hash,
            expires_at_ledger,
        }
        .publish(&env);
    }

    /// Sub-account equivalent of `cancel_invite`.
    pub fn cancel_subaccount_invite(env: Env, token_hash: BytesN<32>) {
        require_admin_auth(&env);
        let key = DataKey::SubAccountInvite(token_hash.clone());
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::InviteNotFound);
        }
        env.storage().persistent().remove(&key);
        SubAccountInviteCancelled {
            invite_hash: token_hash,
        }
        .publish(&env);
    }

    /// Sub-account holder redeems an invite. Registers the caller in the
    /// SubAccounts vec with zero balance, unlocked. Reject if already a
    /// member or already a sub-account; sub-accounts and members are
    /// disjoint identity sets.
    pub fn join_as_subaccount(env: Env, caller: Address, invite_token: BytesN<32>) {
        caller.require_auth();
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::NotInitialized);
        }
        let token_hash: BytesN<32> = env.crypto().sha256(&Bytes::from(invite_token)).into();
        let invite_key = DataKey::SubAccountInvite(token_hash.clone());
        let expires_at_ledger: u32 = env
            .storage()
            .persistent()
            .get(&invite_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InviteNotFound));
        if env.ledger().sequence() > expires_at_ledger {
            env.storage().persistent().remove(&invite_key);
            panic_with_error!(&env, Error::InviteExpired);
        }
        let inst = env.storage().instance();
        let members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        if find_member_index(&members, &caller).is_some() {
            panic_with_error!(&env, Error::DuplicateSubAccount);
        }
        let mut subs = load_subaccounts(&env);
        if find_subaccount_index(&subs, &caller).is_some() {
            panic_with_error!(&env, Error::DuplicateSubAccount);
        }
        if subs.len() >= MAX_SUBACCOUNTS {
            panic_with_error!(&env, Error::SubAccountLimitReached);
        }
        subs.push_back(SubAccount {
            address: caller.clone(),
            balance: 0,
            locked: false,
        });
        inst.set(&DataKey::SubAccounts, &subs);
        env.storage().persistent().remove(&invite_key);
        SubAccountJoined {
            subaccount: caller.clone(),
        }
        .publish(&env);
        InviteRedeemed {
            invite_hash: token_hash,
            member: caller,
        }
        .publish(&env);
    }

    /// Admin tops up a sub-account from a specific envelope. Internal ledger
    /// transfer: debits the envelope, credits the sub. No token leaves the
    /// contract — custody stays here until the sub-account holder withdraws.
    pub fn fund_subaccount(env: Env, envelope: Envelope, recipient: Address, amount: i128) {
        require_admin_auth(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Auto-redeems from USDY when the envelope is Savings and its
        // cache is short — same transparent-Earn magic as `execute_withdraw`.
        let mut balances = ensure_envelope_liquidity(&env, envelope, amount);
        let inst = env.storage().instance();
        let idx = envelope.index();
        let current = balances.get(idx).unwrap();
        if current < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        let mut subs = load_subaccounts(&env);
        let sub_idx = find_subaccount_index(&subs, &recipient)
            .unwrap_or_else(|| panic_with_error!(&env, Error::SubAccountNotFound));
        balances.set(idx, current - amount);
        let mut sub = subs.get(sub_idx).unwrap();
        sub.balance += amount;
        subs.set(sub_idx, sub);
        inst.set(&DataKey::Balances, &balances);
        inst.set(&DataKey::SubAccounts, &subs);
        SubAccountFunded {
            recipient,
            envelope,
            amount,
        }
        .publish(&env);
    }

    /// Sub-account holder pulls funds out of their tracked balance into
    /// their own wallet. Refuses if admin has locked them. Cashout (PDAX)
    /// completes from there, same shape as `withdraw` for members.
    pub fn withdraw_subaccount(env: Env, caller: Address, amount: i128, memo: String) {
        caller.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let mut subs = load_subaccounts(&env);
        let sub_idx = find_subaccount_index(&subs, &caller)
            .unwrap_or_else(|| panic_with_error!(&env, Error::SubAccountNotFound));
        let mut sub = subs.get(sub_idx).unwrap();
        if sub.locked {
            panic_with_error!(&env, Error::SubAccountLocked);
        }
        if sub.balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        token::Client::new(&env, &payment_token).transfer(
            &env.current_contract_address(),
            &caller,
            &amount,
        );
        sub.balance -= amount;
        subs.set(sub_idx, sub);
        inst.set(&DataKey::SubAccounts, &subs);
        SubAccountWithdraw {
            caller,
            amount,
            memo,
        }
        .publish(&env);
    }

    pub fn lock_subaccount(env: Env, subaccount: Address) {
        set_subaccount_lock(&env, &subaccount, true);
    }

    pub fn unlock_subaccount(env: Env, subaccount: Address) {
        set_subaccount_lock(&env, &subaccount, false);
    }

    /// One-shot opt-in to USDY-yielded Earn. `usdy_contract` is the SAC
    /// address of the USDY-shaped token (MockUSDY on testnet, real Ondo
    /// USDY once it ships on Stellar). Validated via a `underlying()`
    /// call that returns the SAC USDY wraps — must equal Sobre's payment
    /// token so a mis-configured deploy traps here instead of later on
    /// a supply.
    ///
    /// Not idempotent: reject if already enabled so we don't silently
    /// swap the token underneath existing principal.
    ///
    /// Sets the USDY contract flag, then migrates the current
    /// `Balances[Savings]` cache into USDY so enabling *immediately*
    /// starts earning yield on the family's existing savings — no
    /// separate "supply" tap required.
    pub fn earn_enable(env: Env, usdy_contract: Address) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        if inst.get::<_, bool>(&DataKey::EarnEnabled).unwrap_or(false) {
            panic_with_error!(&env, Error::EarnAlreadyEnabled);
        }
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let usdy_underlying =
            UsdyTokenClient::new(&env, &usdy_contract).underlying();
        if usdy_underlying != payment_token {
            // USDY's underlying must match Sobre's payment token — otherwise
            // deposit/redeem would move the wrong asset.
            panic_with_error!(&env, Error::InvalidAmount);
        }
        inst.set(&DataKey::EarnUsdyContract, &usdy_contract);
        inst.set(&DataKey::EarnEnabled, &true);
        EarnEnabledEvent {
            usdy_contract: usdy_contract.clone(),
        }
        .publish(&env);

        // Migrate the current Savings envelope balance into USDY so the
        // "turn on Earn, watch it earn immediately" story works even for
        // wallets that had funds sitting in Savings pre-enable.
        let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let savings_idx = Envelope::Savings.index();
        let savings_cache = balances.get(savings_idx).unwrap();
        if savings_cache > 0 {
            balances.set(savings_idx, 0);
            inst.set(&DataKey::Balances, &balances);
            do_usdy_deposit(&env, Envelope::Savings, savings_cache);
            EarnSupply {
                envelope: Envelope::Savings,
                amount: savings_cache,
            }
            .publish(&env);
        }
    }

    /// Admin explicitly moves `amount` USDC stroops from `envelope`'s cache
    /// into USDY. Normally callers don't reach for this — Savings gets
    /// auto-supplied on deposit and auto-redeemed on withdraw — but it's kept
    /// as an escape hatch for Groceries/Tuition or for post-hoc migration.
    pub fn earn_supply(env: Env, envelope: Envelope, amount: i128) {
        require_admin_auth(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let env_idx = envelope.index();
        let current = balances.get(env_idx).unwrap();
        if current < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        balances.set(env_idx, current - amount);
        inst.set(&DataKey::Balances, &balances);
        do_usdy_deposit(&env, envelope, amount);
        EarnSupply {
            envelope,
            amount,
        }
        .publish(&env);
    }

    /// Admin explicitly pulls `amount` USDC stroops back from USDY into
    /// `envelope`'s cache. Escape hatch — auto-redeem already covers the
    /// Savings withdraw path.
    pub fn earn_withdraw(env: Env, envelope: Envelope, amount: i128) {
        require_admin_auth(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        do_usdy_redeem(&env, envelope, amount);
        let inst = env.storage().instance();
        let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let env_idx = envelope.index();
        balances.set(env_idx, balances.get(env_idx).unwrap() + amount);
        inst.set(&DataKey::Balances, &balances);
        EarnWithdraw {
            envelope,
            amount,
        }
        .publish(&env);
    }

    /// One-shot opt-in to the Grow bucket. Sets `GrowEnabled = true`,
    /// pins the Blend pool + XLM SAC + Soroswap router used for the
    /// swap-sandwich, and initializes an empty balance. Second call panics
    /// — Grow, like Earn, isn't idempotent because a re-enable could
    /// silently orphan a stale bToken position.
    ///
    /// The `get_reserve` probe validates the pool+asset combination
    /// resolves — an invalid pool traps here, not later on a supply.
    pub fn grow_enable(
        env: Env,
        pool_id: Address,
        xlm_asset: Address,
        soroswap_router: Address,
    ) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        if inst.get::<_, bool>(&DataKey::GrowEnabled).unwrap_or(false) {
            panic_with_error!(&env, Error::GrowAlreadyEnabled);
        }
        pool::Client::new(&env, &pool_id).get_reserve(&xlm_asset);
        inst.set(&DataKey::GrowPoolId, &pool_id);
        inst.set(&DataKey::GrowXlmAsset, &xlm_asset);
        inst.set(&DataKey::GrowSoroswapRouter, &soroswap_router);
        inst.set(&DataKey::GrowEnabled, &true);
        inst.set(&DataKey::GrowBalance, &0i128);
        GrowEnabledEvent {
            pool: pool_id,
            xlm_asset,
            soroswap_router,
        }
        .publish(&env);
    }

    /// Admin transfers `amount` USDC stroops from the Savings envelope
    /// into the Grow bucket. When Earn is enabled and the Savings cache
    /// is short, first auto-redeems the shortfall from USDY. Then swaps
    /// USDC → XLM on Soroswap (with a 2% slippage floor) and supplies
    /// the resulting XLM to Blend under Grow's attribution.
    pub fn grow_transfer_from_savings(env: Env, amount: i128) {
        require_admin_auth(&env);
        require_grow_enabled(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Auto-redeem from USDY for Savings if the cache is short.
        let mut balances = ensure_envelope_liquidity(&env, Envelope::Savings, amount);
        let inst = env.storage().instance();
        let savings_idx = Envelope::Savings.index();
        let current_savings = balances.get(savings_idx).unwrap();
        if current_savings < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        balances.set(savings_idx, current_savings - amount);
        inst.set(&DataKey::Balances, &balances);

        let xlm_received = do_soroswap_swap_usdc_to_xlm(&env, amount);
        do_grow_blend_supply(&env, xlm_received);

        let prior_supplied: i128 = inst.get(&DataKey::GrowSuppliedUsdcTotal).unwrap_or(0);
        inst.set(&DataKey::GrowSuppliedUsdcTotal, &(prior_supplied + amount));

        GrowTransfer {
            amount,
            xlm_supplied: xlm_received,
        }
        .publish(&env);
    }

    /// Admin queues a Grow withdrawal for `amount` USDC. Reserves `amount`
    /// against the total Grow value (cache + Blend underlying valued via
    /// current Soroswap rate) immediately — a second concurrent request
    /// that would over-commit trips InsufficientBalance upfront.
    pub fn request_grow_withdrawal(env: Env, amount: i128) -> u64 {
        require_admin_auth(&env);
        require_grow_enabled(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        let total = grow_total_value_usdc(&env);
        let mut requests = load_grow_requests(&env);
        let reserved: i128 = requests.iter().fold(0i128, |acc, r| acc + r.amount);
        if total - reserved < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let id: u64 = inst.get(&DataKey::NextGrowReqId).unwrap_or(0u64);
        inst.set(&DataKey::NextGrowReqId, &(id + 1));

        let unlock_at = env.ledger().timestamp() + GROW_TIMELOCK_SECS;
        let req = GrowWithdrawRequest {
            id,
            requester: admin.clone(),
            amount,
            unlock_at,
        };
        requests.push_back(req);
        store_grow_requests(&env, &requests);

        GrowRequest {
            request_id: id,
            requester: admin,
            amount,
            unlock_at,
        }
        .publish(&env);
        id
    }

    /// After the 48h timelock, the requester unlocks and receives the USDC
    /// directly into their own wallet. Withdraws enough XLM from Blend to
    /// cover the request's USDC amount at the current Soroswap rate (with
    /// a 2% headroom for slippage), then swaps XLM → USDC on Soroswap
    /// with the exact-out target being the request's amount. Any XLM
    /// Soroswap doesn't consume gets left in the contract's balance for
    /// the next withdrawal to consume (rare — usually tiny rounding
    /// difference).
    pub fn execute_grow_withdrawal(env: Env, request_id: u64) {
        let mut requests = load_grow_requests(&env);
        let idx = find_grow_request_index(&requests, request_id)
            .unwrap_or_else(|| panic_with_error!(&env, Error::GrowRequestNotFound));
        let req = requests.get(idx).unwrap();

        req.requester.require_auth();

        if env.ledger().timestamp() < req.unlock_at {
            panic_with_error!(&env, Error::GrowTimelockNotElapsed);
        }

        let inst = env.storage().instance();
        // Cache-first: if the idle GrowBalance covers the request, no
        // Blend/Soroswap round trip needed.
        let cache: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
        let (usdc_out_from_cache, need_from_pool) = if cache >= req.amount {
            (req.amount, 0i128)
        } else {
            (cache, req.amount - cache)
        };

        let mut xlm_withdrawn: i128 = 0;
        if need_from_pool > 0 {
            // Peek Soroswap quote for how much XLM we'd need to buy
            // `need_from_pool` USDC. Add 2% headroom for slippage during
            // the actual swap.
            let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
            let xlm_asset: Address = inst.get(&DataKey::GrowXlmAsset).unwrap();
            let router: Address = inst.get(&DataKey::GrowSoroswapRouter).unwrap();
            let quote_path: Vec<Address> = vec![&env, xlm_asset, payment_token];
            let quote = SoroswapRouterClient::new(&env, &router)
                .router_get_amounts_in(&need_from_pool, &quote_path);
            let quoted_xlm_in = quote.get(0).unwrap_or(0);
            if quoted_xlm_in <= 0 {
                panic_with_error!(&env, Error::InvalidAmount);
            }
            let xlm_needed = (quoted_xlm_in * 102) / 100;
            do_grow_blend_withdraw(&env, xlm_needed);
            xlm_withdrawn = xlm_needed;
            // Swap the withdrawn XLM to exactly `need_from_pool` USDC.
            let xlm_consumed = do_soroswap_swap_xlm_to_usdc_exact_out(&env, need_from_pool);
            // Any XLM the router didn't need stays as XLM in Sobre's
            // balance for now — future logic could re-supply it to Blend.
            // Sanity: consumed must not exceed what we withdrew.
            if xlm_consumed > xlm_needed {
                panic_with_error!(&env, Error::InsufficientBalance);
            }
        }

        // Pay out from GrowBalance cache first, then the freshly-swapped
        // USDC covers the rest. Both are in Sobre's payment-token balance
        // by now; just transfer the total.
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        token::Client::new(&env, &payment_token).transfer(
            &env.current_contract_address(),
            &req.requester,
            &req.amount,
        );
        inst.set(&DataKey::GrowBalance, &(cache - usdc_out_from_cache));

        let prior_withdrawn: i128 = inst.get(&DataKey::GrowWithdrawnUsdcTotal).unwrap_or(0);
        inst.set(
            &DataKey::GrowWithdrawnUsdcTotal,
            &(prior_withdrawn + req.amount),
        );

        requests.remove(idx);
        store_grow_requests(&env, &requests);

        GrowExecute {
            request_id: req.id,
            requester: req.requester,
            amount: req.amount,
            xlm_withdrawn,
        }
        .publish(&env);
    }

    /// Cancels a pending grow-withdraw request. Funds stay in the bucket;
    /// the requester frees up the reserved amount and can queue a new
    /// request whenever they want (starting a fresh 48h timer).
    pub fn cancel_grow_withdrawal(env: Env, request_id: u64) {
        let mut requests = load_grow_requests(&env);
        let idx = find_grow_request_index(&requests, request_id)
            .unwrap_or_else(|| panic_with_error!(&env, Error::GrowRequestNotFound));
        let req = requests.get(idx).unwrap();
        req.requester.require_auth();
        requests.remove(idx);
        store_grow_requests(&env, &requests);
        GrowCancel {
            request_id: req.id,
            requester: req.requester,
            amount: req.amount,
        }
        .publish(&env);
    }

    /// Polled by both dashboards. Only on-chain truth — display + family
    /// rules (split, policy, pending requests) live in Supabase and the
    /// dashboard joins them client-side.
    pub fn get_state(env: Env) -> WalletState {
        let inst = env.storage().instance();
        let admin: Address = inst
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        let members: Vec<Member> = inst.get(&DataKey::Members).unwrap();
        let balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let subaccounts = load_subaccounts(&env);
        let earn = load_earn_state(&env);
        let grow_enabled: bool =
            inst.get(&DataKey::GrowEnabled).unwrap_or(false);
        let (grow_balance, grow_requests, grow_supplied_total, grow_withdrawn_total) =
            if grow_enabled {
                let balance = grow_total_value_usdc(&env);
                let next_id: u64 = inst.get(&DataKey::NextGrowReqId).unwrap_or(0);
                let requests = if next_id > 0 {
                    load_grow_requests(&env)
                } else {
                    Vec::new(&env)
                };
                let supplied: i128 =
                    inst.get(&DataKey::GrowSuppliedUsdcTotal).unwrap_or(0);
                let withdrawn: i128 =
                    inst.get(&DataKey::GrowWithdrawnUsdcTotal).unwrap_or(0);
                (balance, requests, supplied, withdrawn)
            } else {
                (0i128, Vec::new(&env), 0i128, 0i128)
            };
        WalletState {
            admin,
            payment_token,
            members,
            balances,
            subaccounts,
            earn,
            grow_balance,
            grow_enabled,
            grow_supplied_total,
            grow_withdrawn_total,
            grow_requests,
        }
    }
}

/// Builds the earn wire shape — an empty vec if disabled, a one-element vec
/// otherwise. Per-envelope current_value is computed as a fair-share of the
/// yield-inclusive USDY total by principal ratio.
fn load_earn_state(env: &Env) -> Vec<EarnState> {
    let inst = env.storage().instance();
    if !inst.get::<_, bool>(&DataKey::EarnEnabled).unwrap_or(false) {
        return Vec::new(env);
    }
    let usdy_contract: Address = inst.get(&DataKey::EarnUsdyContract).unwrap();
    let mut positions: Vec<EarnPosition> = Vec::new(env);
    // Skip the cross-contract `balance_of` when there are no live positions
    // — an enabled-but-idle wallet's dashboard poll doesn't need it. Also
    // means the envelope loop below can short-circuit `current_usdy_value`
    // math without a false-yield emit on historical-only envelopes.
    let principal_all = sum_usdy_principal(env);
    let usdy_total = if principal_all > 0 {
        UsdyTokenClient::new(env, &usdy_contract).balance_of(&env.current_contract_address())
    } else {
        0
    };
    for envelope in ENVELOPES.iter() {
        let principal: i128 = inst
            .get(&DataKey::EarnUsdyPrincipal(*envelope))
            .unwrap_or(0);
        let supplied: i128 = inst
            .get(&DataKey::EarnUsdySupplied(*envelope))
            .unwrap_or(0);
        let withdrawn: i128 = inst
            .get(&DataKey::EarnUsdyWithdrawn(*envelope))
            .unwrap_or(0);
        // Emit any envelope with either a live position OR historical
        // activity — a fully round-tripped envelope (supplied == withdrawn,
        // principal == 0) still deserves its interest-earned row on the
        // dashboard so the family sees "we earned $X on Groceries earlier
        // this year" even after the position was pulled back.
        if principal <= 0 && supplied <= 0 && withdrawn <= 0 {
            continue;
        }
        let current_value = current_usdy_value(usdy_total, principal, principal_all);
        let raw_interest = current_value + withdrawn - supplied;
        let interest_earned = if raw_interest < 0 { 0 } else { raw_interest };
        positions.push_back(EarnPosition {
            envelope: *envelope,
            principal,
            current_value,
            supplied_total: supplied,
            withdrawn_total: withdrawn,
            interest_earned,
        });
    }
    vec![
        env,
        EarnState {
            usdy_contract,
            positions,
        },
    ]
}

mod test;
