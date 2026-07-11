#![no_std]
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
};

use blend_contract_sdk::pool::{self, Request as PoolRequest};

const MAX_MEMBERS: u32 = 2;
const MAX_SUBACCOUNTS: u32 = 4;

/// Blend v2 non-collateral supply request. bTokens are minted; no collateral
/// factor, no borrow surface. That's the "just earn yield on my spare XLM"
/// shape Sobre's Savings envelope wants.
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
/// The contract only cares which addresses are authorized to spend.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Member {
    pub address: Address,
}

/// Supplementary-card holder. A separate identity tier from `Member`:
/// sub-accounts can only spend from their own `balance` (not envelopes),
/// admin tops them up from any envelope via `fund_subaccount`, and admin can
/// flip `locked` to freeze spending instantly. Token custody stays with the
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
    /// Whether admin has opted this wallet into Blend yield. Absent key
    /// defaults to false so pre-upgrade instances read as disabled.
    EarnEnabled,
    /// Address of the Blend v2 pool this wallet supplies into. One pool
    /// shared across all envelopes that opt into Earn.
    EarnPoolId,
    /// Address of the SEP-41 SAC being supplied. For the XLM demo this equals
    /// PaymentToken; kept separate so a future USDC-yield flip doesn't rely
    /// on the payment token matching.
    EarnAsset,
    /// Sobre's cumulative bToken position attributable to a given envelope.
    /// Sum across envelopes + `EarnGrowBToken` equals Sobre's aggregate
    /// `positions.supply` on the pool. Underlying = this * b_rate / SCALAR_12.
    EarnBToken(Envelope),
    /// Monotonic cumulative underlying-stroops supplied to Blend for this
    /// envelope, across the wallet's lifetime. Never decreases. Used with
    /// `EarnWithdrawnTotal` to derive `interest_earned = underlying +
    /// withdrawn - supplied` for the dashboard.
    EarnSuppliedTotal(Envelope),
    /// Monotonic cumulative underlying-stroops withdrawn from Blend for this
    /// envelope. Never decreases. Interest formula above.
    EarnWithdrawnTotal(Envelope),
    /// Grow's separate Blend position — bTokens attributable to the Grow
    /// bucket, kept distinct from envelope-tagged EarnBToken so Grow's
    /// timelocked accounting stays isolated from Savings' spend path.
    EarnGrowBToken,
    /// Monotonic supplied total for the Grow-side Blend position.
    EarnGrowSuppliedTotal,
    /// Monotonic withdrawn total for the Grow-side Blend position.
    EarnGrowWithdrawnTotal,
    /// Whether admin has opted this wallet into the Grow bucket. Absent key
    /// defaults to false so pre-upgrade instances read as disabled.
    GrowEnabled,
    /// Payment-token stroops locked in the Grow bucket. Distinct from the
    /// three splittable envelopes — Grow has its own 48h-timelocked exit
    /// path, not the immediate spend/subaccount-fund affordances envelopes
    /// have.
    GrowBalance,
    /// Monotonically increasing counter for grow-withdraw request IDs.
    /// Absent key defaults to 0. First request minted gets id=0. Never
    /// resets (even after all requests clear) so the audit log has stable
    /// external identifiers.
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
    /// vec carrying the pool + asset + per-envelope positions. Vec-of-one is
    /// the wire shape for optional here: `contracttype` doesn't auto-derive
    /// `Option<T>` XDR conversion for our own struct types (SDK 25).
    pub earn: Vec<EarnState>,
    /// Grow-bucket balance (payment-token stroops locked under the 48h
    /// timelock). Zero — with no active requests — when Grow hasn't been
    /// enabled or hasn't had funds transferred in yet.
    pub grow_balance: i128,
    /// Whether the wallet has opted into Grow. Distinct from
    /// `grow_balance > 0` because a wallet can be enabled with an empty
    /// bucket (initial state after `grow_enable`).
    pub grow_enabled: bool,
    /// Active grow-withdraw requests, insertion order. Frontend renders
    /// per-request countdowns from `unlock_at - now`. Empty when no
    /// request is pending.
    pub grow_requests: Vec<GrowWithdrawRequest>,
}

/// Only present when Earn is enabled. `positions` includes an entry per
/// envelope that currently holds a non-zero bToken balance; empty vec means
/// enabled-but-no-supply-yet. `grow_position` is a 0-or-1 vec carrying
/// Grow's separate Blend position when it has one.
#[contracttype]
#[derive(Clone)]
pub struct EarnState {
    pub pool: Address,
    pub asset: Address,
    pub positions: Vec<EarnPosition>,
    pub grow_position: Vec<GrowEarnPosition>,
}

/// A single envelope's Blend position. `underlying` is computed live from
/// the current b_rate at get_state time. `interest_earned` is derived as
/// `underlying + withdrawn_total - supplied_total`, giving a running total
/// of interest accrued to this envelope across the wallet's lifetime.
#[contracttype]
#[derive(Clone)]
pub struct EarnPosition {
    pub envelope: Envelope,
    pub b_tokens: i128,
    pub underlying: i128,
    pub supplied_total: i128,
    pub withdrawn_total: i128,
    pub interest_earned: i128,
}

/// Grow's Blend position. Parallels EarnPosition but not envelope-tagged
/// (Grow is its own bucket, not an envelope). Only present in
/// `WalletState.earn` when both Earn AND Grow are enabled AND Grow has
/// supplied at least once.
#[contracttype]
#[derive(Clone)]
pub struct GrowEarnPosition {
    pub b_tokens: i128,
    pub underlying: i128,
    pub supplied_total: i128,
    pub withdrawn_total: i128,
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

/// Emitted by `spend` (self-spend) AND `spend_on_behalf` (admin-released).
/// `caller` is always the member whose envelope was debited.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Spend {
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

#[contractevent]
#[derive(Clone, Debug)]
pub struct SubAccountJoined {
    #[topic]
    pub subaccount: Address,
}

/// Topic shape mirrors Spend so the activity feed reuses one decoder.
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
pub struct SubAccountSpent {
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
    pub pool: Address,
    #[topic]
    pub asset: Address,
}

/// Emitted by `earn_supply`. `amount` is underlying (XLM stroops); `b_tokens`
/// is the fresh position delta the pool returned. b_rate slippage between
/// simulate and submit means amount ≠ b_tokens * scalar.
#[contractevent]
#[derive(Clone, Debug)]
pub struct EarnSupply {
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
    pub b_tokens: i128,
}

/// Emitted by `earn_withdraw`. `amount` is underlying returned to the
/// envelope; `b_tokens` is the position delta burned. Same b_rate slippage
/// note applies.
#[contractevent]
#[derive(Clone, Debug)]
pub struct EarnWithdraw {
    #[topic]
    pub envelope: Envelope,
    pub amount: i128,
    pub b_tokens: i128,
}

/// Emitted once per Sobre wallet lifetime by `grow_enable`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowEnabledEvent {}

/// Emitted by `grow_transfer_from_savings` — funds cross from the Savings
/// envelope into the Grow bucket. No token leaves the contract; this is
/// pure internal accounting.
#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowTransfer {
    pub amount: i128,
}

/// Emitted by `request_grow_withdrawal`. `unlock_at` is the earliest
/// unix-seconds timestamp at which `execute_grow_withdrawal` will succeed.
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

/// Emitted by `execute_grow_withdrawal`. Tokens have left the contract
/// and landed in the requester's wallet; the corresponding request entry
/// has been removed.
#[contractevent]
#[derive(Clone, Debug)]
pub struct GrowExecute {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub requester: Address,
    pub amount: i128,
}

/// Emitted by `cancel_grow_withdrawal`. Funds stay in the Grow bucket;
/// the request is cleared and the requester can retry with a fresh
/// timelock at any time.
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

/// Loads Earn config; panics with EarnNotEnabled if the wallet hasn't opted in.
/// Reserve index is derived from a live `get_reserve` call at submit time —
/// no cached storage slot, no chance of drift if Blend ever remaps reserves.
fn load_earn_config(env: &Env) -> (Address, Address) {
    let inst = env.storage().instance();
    if !inst.get::<_, bool>(&DataKey::EarnEnabled).unwrap_or(false) {
        panic_with_error!(env, Error::EarnNotEnabled);
    }
    let pool: Address = inst.get(&DataKey::EarnPoolId).unwrap();
    let asset: Address = inst.get(&DataKey::EarnAsset).unwrap();
    (pool, asset)
}

/// Pre-authorizes a `token.transfer(self → pool, amount)` sub-invocation so
/// the pool contract can pull the underlying from Sobre when it processes a
/// Supply request. Without this the pool's inner `require_auth` would trap.
fn authorize_pool_pull(env: &Env, self_addr: &Address, asset: &Address, pool: &Address, amount: i128) {
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: asset.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (self_addr.clone(), pool.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);
}

/// Attribution key for an Earn operation — which internal accounting slot
/// the delta belongs to. Envelope positions live under `EarnBToken(env)`;
/// the Grow position lives under `EarnGrowBToken`.
enum EarnAttribution {
    Envelope(Envelope),
    Grow,
}

impl EarnAttribution {
    fn b_token_key(&self) -> DataKey {
        match self {
            EarnAttribution::Envelope(e) => DataKey::EarnBToken(*e),
            EarnAttribution::Grow => DataKey::EarnGrowBToken,
        }
    }
    fn supplied_key(&self) -> DataKey {
        match self {
            EarnAttribution::Envelope(e) => DataKey::EarnSuppliedTotal(*e),
            EarnAttribution::Grow => DataKey::EarnGrowSuppliedTotal,
        }
    }
    fn withdrawn_key(&self) -> DataKey {
        match self {
            EarnAttribution::Envelope(e) => DataKey::EarnWithdrawnTotal(*e),
            EarnAttribution::Grow => DataKey::EarnGrowWithdrawnTotal,
        }
    }
}

/// Runs one Blend submit (Supply or Withdraw) and returns the |delta| of
/// Sobre's aggregate bTokens on this reserve. Caller supplies the prior
/// aggregate and attributes the delta downstream.
fn submit_earn_request(
    env: &Env,
    pool: &Address,
    asset: &Address,
    request_type: u32,
    amount: i128,
    prior_total_b_tokens: i128,
) -> i128 {
    let self_addr = env.current_contract_address();
    let pool_client = pool::Client::new(env, pool);
    let reserve_index = pool_client.get_reserve(asset).config.index;
    if request_type == REQUEST_TYPE_SUPPLY {
        authorize_pool_pull(env, &self_addr, asset, pool, amount);
    }
    let requests: Vec<PoolRequest> = vec![
        env,
        PoolRequest {
            request_type,
            address: asset.clone(),
            amount,
        },
    ];
    let positions = pool_client.submit(&self_addr, &self_addr, &self_addr, &requests);
    let new_total: i128 = positions.supply.get(reserve_index).unwrap_or(0);
    (new_total - prior_total_b_tokens).abs()
}

/// Sobre's aggregate bTokens across all envelopes + Grow. Sum must equal
/// Blend's `positions.supply` for our reserve at any point in time.
fn sum_earn_b_tokens(env: &Env) -> i128 {
    let inst = env.storage().instance();
    let envelope_sum = ENVELOPES.iter().fold(0i128, |acc, e| {
        acc + inst.get::<_, i128>(&DataKey::EarnBToken(*e)).unwrap_or(0)
    });
    let grow = inst.get::<_, i128>(&DataKey::EarnGrowBToken).unwrap_or(0);
    envelope_sum + grow
}

/// Supplies `amount` underlying stroops to Blend and attributes the position
/// delta (bTokens minted) to the caller-specified attribution slot. Bumps
/// that slot's `SuppliedTotal` by `amount`. Returns the bToken delta so
/// callers can emit auditable events. Assumes the caller has already
/// verified the source has the stroops available — this helper only speaks
/// to Blend, not to envelope/grow-balance accounting.
fn do_earn_supply(env: &Env, attribution: EarnAttribution, amount: i128) -> i128 {
    let (pool, asset) = load_earn_config(env);
    let inst = env.storage().instance();
    let prior_total = sum_earn_b_tokens(env);
    let delta = submit_earn_request(
        env,
        &pool,
        &asset,
        REQUEST_TYPE_SUPPLY,
        amount,
        prior_total,
    );
    let btoken_key = attribution.b_token_key();
    let prior_slot: i128 = inst.get(&btoken_key).unwrap_or(0);
    inst.set(&btoken_key, &(prior_slot + delta));
    let supplied_key = attribution.supplied_key();
    let prior_supplied: i128 = inst.get(&supplied_key).unwrap_or(0);
    inst.set(&supplied_key, &(prior_supplied + amount));
    delta
}

/// Withdraws `amount` underlying stroops from Blend and attributes the
/// bTokens burned to the caller-specified attribution slot. Bumps that
/// slot's `WithdrawnTotal` by `amount`. Returns the bToken delta so
/// callers can emit auditable events. Panics if the delta would exceed
/// the attribution's tracked bTokens (envelope-attribution invariant:
/// a Savings withdraw must not burn Grow's shares or a sibling envelope's).
fn do_earn_withdraw(env: &Env, attribution: EarnAttribution, amount: i128) -> i128 {
    let (pool, asset) = load_earn_config(env);
    let inst = env.storage().instance();
    let btoken_key = attribution.b_token_key();
    let prior_slot: i128 = inst.get(&btoken_key).unwrap_or(0);
    if prior_slot <= 0 {
        panic_with_error!(env, Error::EarnInsufficientPosition);
    }
    let prior_total = sum_earn_b_tokens(env);
    let delta = submit_earn_request(
        env,
        &pool,
        &asset,
        REQUEST_TYPE_WITHDRAW,
        amount,
        prior_total,
    );
    if delta > prior_slot {
        // Attribution invariant: a withdraw can't burn more shares than
        // this slot holds — otherwise it'd be draining a sibling's stake.
        panic_with_error!(env, Error::EarnInsufficientPosition);
    }
    inst.set(&btoken_key, &(prior_slot - delta));
    let withdrawn_key = attribution.withdrawn_key();
    let prior_withdrawn: i128 = inst.get(&withdrawn_key).unwrap_or(0);
    inst.set(&withdrawn_key, &(prior_withdrawn + amount));
    delta
}

/// True when Earn is enabled — used by the P0 paths (deposit / spend /
/// fund_subaccount / grow_transfer / close_wallet) to decide whether to
/// route Savings through Blend or use the raw envelope cache.
fn is_earn_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::EarnEnabled)
        .unwrap_or(false)
}

/// Underlying-stroops value of `b_tokens` at the current b_rate. Fires one
/// cross-contract `get_reserve` — cheap during simulate, tolerable during
/// close_wallet's real submission (only paid once per envelope with a
/// non-zero position).
fn current_underlying(env: &Env, b_tokens: i128) -> i128 {
    if b_tokens <= 0 {
        return 0;
    }
    let inst = env.storage().instance();
    let pool_id: Address = inst.get(&DataKey::EarnPoolId).unwrap();
    let asset: Address = inst.get(&DataKey::EarnAsset).unwrap();
    let b_rate = pool::Client::new(env, &pool_id).get_reserve(&asset).data.b_rate;
    (b_tokens * b_rate) / SCALAR_12
}

/// Grow's total value = the payment-token cache in `GrowBalance` plus the
/// current underlying of the Grow-attributed Blend position. Used by
/// request/reservation math so the family can request against their real
/// Grow balance (which is mostly in Blend when Earn is on).
fn grow_total_value(env: &Env) -> i128 {
    let inst = env.storage().instance();
    let cache: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
    let b: i128 = inst.get(&DataKey::EarnGrowBToken).unwrap_or(0);
    if b > 0 {
        cache + current_underlying(env, b)
    } else {
        cache
    }
}

/// Ensures `GrowBalance` has at least `amount` stroops available. When
/// Earn is on and the cache is short, auto-withdraws the shortfall from
/// Blend under Grow's attribution. Mirrors `ensure_envelope_liquidity`
/// but for the Grow bucket. Called from `execute_grow_withdrawal`.
fn ensure_grow_liquidity(env: &Env, amount: i128) {
    let inst = env.storage().instance();
    let cache: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
    if cache >= amount || !is_earn_enabled(env) {
        return;
    }
    let shortfall = amount - cache;
    do_earn_withdraw(env, EarnAttribution::Grow, shortfall);
    inst.set(&DataKey::GrowBalance, &(cache + shortfall));
}

/// Ensures `Balances[envelope]` has at least `amount` stroops available.
/// When Earn is enabled and the envelope's cache is short, auto-withdraws
/// the shortfall from Blend for that envelope's attribution and credits
/// the cache. Returns the balances vec (mutated in-place so callers can
/// do their own debit and one `inst.set` on the way out).
///
/// This is the "transparent Earn" magic — spenders/subaccount-funders
/// never call `earn_withdraw` themselves; they just call `spend` and this
/// helper handles the Blend round-trip in the same tx.
fn ensure_envelope_liquidity(env: &Env, envelope: Envelope, amount: i128) -> Vec<i128> {
    let inst = env.storage().instance();
    let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
    let idx = envelope.index();
    let current = balances.get(idx).unwrap();
    if current >= amount || !is_earn_enabled(env) {
        // Either the cache covers the ask or there's no Blend fallback to
        // reach for — either way, let the caller run its normal balance
        // check (which will pass or InsufficientBalance-panic).
        return balances;
    }
    let shortfall = amount - current;
    do_earn_withdraw(env, EarnAttribution::Envelope(envelope), shortfall);
    balances.set(idx, current + shortfall);
    inst.set(&DataKey::Balances, &balances);
    balances
}

const ENVELOPES: [Envelope; 3] = [Envelope::Groceries, Envelope::Tuition, Envelope::Savings];

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

fn require_grow_enabled(env: &Env) {
    if !env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::GrowEnabled)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::GrowNotEnabled);
    }
}

/// Shared by `spend` and `spend_on_behalf`. Assumes auth + member checks
/// already done. Transfers tokens to `caller`'s wallet, debits the envelope,
/// emits Spend with `caller` as the topic. When Earn is enabled and the
/// envelope's cache is short, `ensure_envelope_liquidity` auto-withdraws
/// from Blend so the spend lands transparently in the same tx.
fn execute_spend(env: &Env, caller: &Address, envelope: Envelope, amount: i128, memo: &String) {
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
    Spend {
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

        // When Earn is enabled, sweep every envelope's Blend position + the
        // Grow-attributed position back into their caches before summing.
        // Otherwise close_wallet would leak custody into the pool.
        if is_earn_enabled(&env) {
            let pool_id: Address = inst.get(&DataKey::EarnPoolId).unwrap();
            let asset: Address = inst.get(&DataKey::EarnAsset).unwrap();
            let b_rate = pool::Client::new(&env, &pool_id)
                .get_reserve(&asset)
                .data
                .b_rate;
            let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
            let mut wrote_balances = false;
            for e in ENVELOPES.iter() {
                let b: i128 = inst.get(&DataKey::EarnBToken(*e)).unwrap_or(0);
                if b <= 0 {
                    continue;
                }
                let underlying = (b * b_rate) / SCALAR_12;
                if underlying <= 0 {
                    continue;
                }
                do_earn_withdraw(&env, EarnAttribution::Envelope(*e), underlying);
                let idx = e.index();
                balances.set(idx, balances.get(idx).unwrap() + underlying);
                wrote_balances = true;
            }
            if wrote_balances {
                inst.set(&DataKey::Balances, &balances);
            }
            let grow_b: i128 = inst.get(&DataKey::EarnGrowBToken).unwrap_or(0);
            if grow_b > 0 {
                let underlying = (grow_b * b_rate) / SCALAR_12;
                if underlying > 0 {
                    do_earn_withdraw(&env, EarnAttribution::Grow, underlying);
                    let cur: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
                    inst.set(&DataKey::GrowBalance, &(cur + underlying));
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
        // Savings routes through Blend when Earn is enabled — the envelope
        // cache stays at its current value (usually 0 post-migration) so
        // spending logic uses `ensure_envelope_liquidity` to auto-withdraw.
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
            do_earn_supply(&env, EarnAttribution::Envelope(Envelope::Savings), savings);
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

    /// Member self-spend. Balance check + transfer to caller + emit. The
    /// approval gate (daily limit, per-tx threshold, protected envelopes)
    /// lives off-chain — the frontend checks Supabase policy before deciding
    /// whether to call this directly or stage an admin-approval request.
    pub fn spend(env: Env, caller: Address, envelope: Envelope, amount: i128, memo: String) {
        caller.require_auth();
        require_member(&env, &caller);
        execute_spend(&env, &caller, envelope, amount, &memo);
    }

    /// Admin-signed release of an approved spend request. The Spend event is
    /// emitted with `member` as the caller topic so the activity feed shows
    /// the request's originator. Tokens land in the member's wallet exactly
    /// as if they had self-spent; from there they complete the cashout
    /// (PDAX) on their own time.
    pub fn spend_on_behalf(
        env: Env,
        member: Address,
        envelope: Envelope,
        amount: i128,
        memo: String,
    ) {
        require_admin_auth(&env);
        require_member(&env, &member);
        execute_spend(&env, &member, envelope, amount, &memo);
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
    /// contract — custody stays here until the sub-account holder spends.
    pub fn fund_subaccount(env: Env, envelope: Envelope, recipient: Address, amount: i128) {
        require_admin_auth(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Auto-withdraws from Blend when the envelope is Savings and its
        // cache is short — same transparent-Earn magic as `execute_spend`.
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

    /// Sub-account holder self-spend. Refuses if admin has locked them.
    /// Transfers tokens to caller's wallet; cashout (PDAX) completes from
    /// there, same shape as `spend` for members.
    pub fn spend_from_subaccount(env: Env, caller: Address, amount: i128, memo: String) {
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
        SubAccountSpent {
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

    /// One-shot opt-in to Blend yield. Admin picks the pool + underlying
    /// asset (the SEP-41 SAC must be a live reserve on that pool). The
    /// `get_reserve` probe validates both addresses resolve — an invalid
    /// pool traps here, not later on a supply.
    ///
    /// Not idempotent: reject if already enabled so we don't silently swap
    /// the pool underneath existing bToken positions.
    /// Enables transparent Earn on this wallet. Sets the pool + asset flags,
    /// then migrates the current `Balances[Savings]` cache into Blend so
    /// enabling *immediately* starts earning yield on the family's existing
    /// savings — no separate "supply" tap required.
    ///
    /// Not idempotent: reject if already enabled so we don't silently swap
    /// the pool underneath existing bToken positions.
    pub fn earn_enable(env: Env, pool_id: Address, asset: Address) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        if inst.get::<_, bool>(&DataKey::EarnEnabled).unwrap_or(false) {
            panic_with_error!(&env, Error::EarnAlreadyEnabled);
        }
        pool::Client::new(&env, &pool_id).get_reserve(&asset);
        inst.set(&DataKey::EarnPoolId, &pool_id);
        inst.set(&DataKey::EarnAsset, &asset);
        inst.set(&DataKey::EarnEnabled, &true);
        EarnEnabledEvent {
            pool: pool_id,
            asset,
        }
        .publish(&env);

        // Migrate the current Savings envelope balance into Blend so the
        // "turn on Earn, watch it earn immediately" story works even for
        // wallets that had funds sitting in Savings pre-enable.
        let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let savings_idx = Envelope::Savings.index();
        let savings_cache = balances.get(savings_idx).unwrap();
        if savings_cache > 0 {
            balances.set(savings_idx, 0);
            inst.set(&DataKey::Balances, &balances);
            let delta = do_earn_supply(
                &env,
                EarnAttribution::Envelope(Envelope::Savings),
                savings_cache,
            );
            EarnSupply {
                envelope: Envelope::Savings,
                amount: savings_cache,
                b_tokens: delta,
            }
            .publish(&env);
        }

        // Same for Grow if it was already enabled and has cached funds —
        // once Earn is on, "in Blend" is the canonical home for both
        // Savings and Grow. Keeps the accounting consistent.
        let grow_enabled: bool = inst
            .get(&DataKey::GrowEnabled)
            .unwrap_or(false);
        if grow_enabled {
            let grow_cache: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
            if grow_cache > 0 {
                inst.set(&DataKey::GrowBalance, &0i128);
                do_earn_supply(&env, EarnAttribution::Grow, grow_cache);
            }
        }
    }

    /// Admin explicitly moves `amount` underlying stroops from `envelope`'s
    /// cache into Blend. Normally callers don't reach for this — Savings
    /// gets auto-supplied on deposit and auto-withdrawn on spend — but
    /// it's kept as an escape hatch for Groceries/Tuition or for post-hoc
    /// migration into Blend.
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
        let delta = do_earn_supply(&env, EarnAttribution::Envelope(envelope), amount);
        EarnSupply {
            envelope,
            amount,
            b_tokens: delta,
        }
        .publish(&env);
    }

    /// Admin explicitly pulls `amount` underlying stroops back from Blend
    /// into `envelope`'s cache. Escape hatch — auto-withdraw already covers
    /// the Savings spend path.
    pub fn earn_withdraw(env: Env, envelope: Envelope, amount: i128) {
        require_admin_auth(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let delta = do_earn_withdraw(&env, EarnAttribution::Envelope(envelope), amount);
        let inst = env.storage().instance();
        let mut balances: Vec<i128> = inst.get(&DataKey::Balances).unwrap();
        let env_idx = envelope.index();
        balances.set(env_idx, balances.get(env_idx).unwrap() + amount);
        inst.set(&DataKey::Balances, &balances);
        EarnWithdraw {
            envelope,
            amount,
            b_tokens: delta,
        }
        .publish(&env);
    }

    /// One-shot opt-in to the Grow bucket. Sets `GrowEnabled = true` and
    /// initializes an empty balance. Second call panics — Grow, like Earn,
    /// isn't idempotent because a re-enable could silently orphan a stale
    /// balance if the semantic ever changed.
    pub fn grow_enable(env: Env) {
        require_admin_auth(&env);
        let inst = env.storage().instance();
        if inst.get::<_, bool>(&DataKey::GrowEnabled).unwrap_or(false) {
            panic_with_error!(&env, Error::GrowAlreadyEnabled);
        }
        inst.set(&DataKey::GrowEnabled, &true);
        inst.set(&DataKey::GrowBalance, &0i128);
        GrowEnabledEvent {}.publish(&env);
    }

    /// Admin transfers `amount` payment-token stroops from the Savings
    /// envelope into the Grow bucket. When Earn is enabled, the transfer
    /// routes through Blend: Savings-attributed shares are burned, Grow-
    /// attributed shares are minted, the token never leaves the pool.
    /// When Earn is off, it's a plain internal ledger move.
    pub fn grow_transfer_from_savings(env: Env, amount: i128) {
        require_admin_auth(&env);
        require_grow_enabled(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Auto-withdraw from Blend for Savings if the cache is short.
        let mut balances = ensure_envelope_liquidity(&env, Envelope::Savings, amount);
        let inst = env.storage().instance();
        let savings_idx = Envelope::Savings.index();
        let current_savings = balances.get(savings_idx).unwrap();
        if current_savings < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        balances.set(savings_idx, current_savings - amount);
        inst.set(&DataKey::Balances, &balances);

        if is_earn_enabled(&env) {
            // Supply to Blend under Grow's attribution. Both the withdraw
            // (in ensure_envelope_liquidity) and the supply happened via
            // Blend, so the token round-trips through the pool.
            do_earn_supply(&env, EarnAttribution::Grow, amount);
        } else {
            let grow_balance: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
            inst.set(&DataKey::GrowBalance, &(grow_balance + amount));
        }
        GrowTransfer { amount }.publish(&env);
    }

    /// Admin queues a Grow withdrawal. Returns the request id so the caller
    /// can address it in a follow-up execute/cancel. Reserves `amount`
    /// against the total Grow value (cache + Blend underlying) immediately —
    /// a second concurrent request that would over-commit trips
    /// InsufficientBalance upfront.
    pub fn request_grow_withdrawal(env: Env, amount: i128) -> u64 {
        require_admin_auth(&env);
        require_grow_enabled(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let inst = env.storage().instance();
        let admin: Address = inst.get(&DataKey::Admin).unwrap();
        let total = grow_total_value(&env);
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

    /// After the 48h timelock, the requester unlocks and receives the
    /// tokens directly into their own wallet. Grow balance drops by the
    /// request amount; the request entry is removed.
    ///
    /// Auth is on `req.requester` — under today's single-admin model that
    /// address IS the current admin, but keying auth off the stored
    /// requester survives the multi-admin backlog landing without a
    /// behavior change.
    pub fn execute_grow_withdrawal(env: Env, request_id: u64) {
        let mut requests = load_grow_requests(&env);
        let idx = find_grow_request_index(&requests, request_id)
            .unwrap_or_else(|| panic_with_error!(&env, Error::GrowRequestNotFound));
        let req = requests.get(idx).unwrap();

        req.requester.require_auth();

        if env.ledger().timestamp() < req.unlock_at {
            panic_with_error!(&env, Error::GrowTimelockNotElapsed);
        }

        // Auto-withdraw from Blend for Grow if the cache can't cover — the
        // funds have been earning yield under Grow's attribution all along,
        // and now flow from Blend → contract → requester in one tx.
        ensure_grow_liquidity(&env, req.amount);

        let inst = env.storage().instance();
        let grow_balance: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
        if grow_balance < req.amount {
            // Should never happen given the reserve-at-request accounting +
            // the ensure_grow_liquidity top-up above. Cheap sanity guard.
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        let payment_token: Address = inst.get(&DataKey::PaymentToken).unwrap();
        token::Client::new(&env, &payment_token).transfer(
            &env.current_contract_address(),
            &req.requester,
            &req.amount,
        );
        inst.set(&DataKey::GrowBalance, &(grow_balance - req.amount));
        requests.remove(idx);
        store_grow_requests(&env, &requests);

        GrowExecute {
            request_id: req.id,
            requester: req.requester,
            amount: req.amount,
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
        let (grow_balance, grow_requests) = if grow_enabled {
            let balance: i128 = inst.get(&DataKey::GrowBalance).unwrap_or(0);
            // Skip the persistent read if no request has ever been minted —
            // covers the enabled-but-idle case that dominates polling
            // traffic once a family clears their queue.
            let next_id: u64 = inst.get(&DataKey::NextGrowReqId).unwrap_or(0);
            let requests = if next_id > 0 {
                load_grow_requests(&env)
            } else {
                Vec::new(&env)
            };
            (balance, requests)
        } else {
            (0i128, Vec::new(&env))
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
            grow_requests,
        }
    }
}

/// Builds the earn wire shape — an empty vec if disabled, a one-element vec
/// otherwise. Underlying value is computed from the LIVE b_rate (via a
/// preflight-only cross-contract read), so yield accrual shows up on every
/// dashboard poll without a write.
fn load_earn_state(env: &Env) -> Vec<EarnState> {
    let inst = env.storage().instance();
    if !inst.get::<_, bool>(&DataKey::EarnEnabled).unwrap_or(false) {
        return Vec::new(env);
    }
    let pool_id: Address = inst.get(&DataKey::EarnPoolId).unwrap();
    let asset: Address = inst.get(&DataKey::EarnAsset).unwrap();
    let mut positions: Vec<EarnPosition> = Vec::new(env);
    let mut b_rate_cache: Option<i128> = None;
    for envelope in ENVELOPES.iter() {
        let b_tokens: i128 = inst.get(&DataKey::EarnBToken(*envelope)).unwrap_or(0);
        if b_tokens <= 0 {
            continue;
        }
        let b_rate = *b_rate_cache.get_or_insert_with(|| {
            pool::Client::new(env, &pool_id).get_reserve(&asset).data.b_rate
        });
        let underlying = (b_tokens * b_rate) / SCALAR_12;
        let supplied: i128 = inst
            .get(&DataKey::EarnSuppliedTotal(*envelope))
            .unwrap_or(0);
        let withdrawn: i128 = inst
            .get(&DataKey::EarnWithdrawnTotal(*envelope))
            .unwrap_or(0);
        // interest_earned = underlying_now + withdrawn_all_time - supplied_all_time.
        // Non-negative under normal Blend behavior; the abs() guard keeps
        // us safe from micro-rounding underflow if b_rate ever regresses.
        let raw_interest = underlying + withdrawn - supplied;
        let interest_earned = if raw_interest < 0 { 0 } else { raw_interest };
        positions.push_back(EarnPosition {
            envelope: *envelope,
            b_tokens,
            underlying,
            supplied_total: supplied,
            withdrawn_total: withdrawn,
            interest_earned,
        });
    }
    let grow_b_tokens: i128 = inst.get(&DataKey::EarnGrowBToken).unwrap_or(0);
    let grow_position: Vec<GrowEarnPosition> = if grow_b_tokens > 0 {
        let b_rate = *b_rate_cache.get_or_insert_with(|| {
            pool::Client::new(env, &pool_id).get_reserve(&asset).data.b_rate
        });
        let underlying = (grow_b_tokens * b_rate) / SCALAR_12;
        let supplied: i128 = inst
            .get(&DataKey::EarnGrowSuppliedTotal)
            .unwrap_or(0);
        let withdrawn: i128 = inst
            .get(&DataKey::EarnGrowWithdrawnTotal)
            .unwrap_or(0);
        let raw = underlying + withdrawn - supplied;
        let interest_earned = if raw < 0 { 0 } else { raw };
        vec![
            env,
            GrowEarnPosition {
                b_tokens: grow_b_tokens,
                underlying,
                supplied_total: supplied,
                withdrawn_total: withdrawn,
                interest_earned,
            },
        ]
    } else {
        Vec::new(env)
    };
    vec![
        env,
        EarnState {
            pool: pool_id,
            asset,
            positions,
            grow_position,
        },
    ]
}

mod test;
