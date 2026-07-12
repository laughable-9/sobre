#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env,
};

/// Sobre's testnet stand-in for Ondo Finance's USDY. Real USDY is an ERC-1400
/// rebasing token backed by short-term US Treasuries — it doesn't exist on
/// Stellar (any network) so this mock ships in its place for the demo.
///
/// Mainnet path swaps this address for the real Ondo contract once Ondo
/// deploys to Stellar. Sobre's earn_supply / earn_withdraw calls this
/// contract's `deposit` / `redeem`, and reads `balance_of` for the
/// yield-inclusive amount on every dashboard poll.
///
/// Yield accrues in the token itself (not in Sobre) so Sobre needs zero
/// yield-math state. When a depositor calls `balance_of(self)` a moment
/// after deposit, the returned value is slightly larger than what they put
/// in — that's the "USDY appreciates automatically" story.

/// 5.00% simulated APY. Roughly matches Ondo's advertised USDY yield as of
/// research pass. Basis points so 500 == 5.00%. Adjust here (single source
/// of truth) if the pitch narrative changes.
const APY_BPS: i128 = 500;
/// 100.00% == 10_000 bps. Divisor for `APY_BPS`.
const BPS_SCALE: i128 = 10_000;
/// Seconds in a Julian year. Ondo quotes APY on a 365-day basis; keep the
/// mock aligned so a 1-year balance projection matches.
const SECS_PER_YEAR: i128 = 365 * 24 * 3600;

#[contracttype]
pub enum DataKey {
    /// Underlying stablecoin (Circle USDC SAC on testnet). Set once at init,
    /// baked into deposit/redeem transfer calls forever.
    Underlying,
    /// Per-holder yield-bearing position. Stored under the depositor's
    /// address so Sobre-the-contract's balance is tracked separately per
    /// family wallet.
    Position(Address),
}

/// A holder's snapshot: the principal (in underlying stroops) they hold as of
/// `since`. `balance_of` computes appreciated value on read; `deposit` and
/// `redeem` settle prior appreciation into `principal` and reset `since` to
/// now, so the compounding math is always applied against a clean base.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub principal: i128,
    pub since: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
}

/// Emitted by `deposit`. `principal_after` is the settled principal on the
/// holder's position — appreciated prior balance plus this deposit's amount.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Deposit {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub principal_after: i128,
}

/// Emitted by `redeem`. `principal_after` is the settled principal that
/// remains on the holder's position after this redemption clears.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Redeem {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub principal_after: i128,
}

fn load_underlying(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Underlying)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

/// principal * (1 + APY * elapsed_secs / SECS_PER_YEAR), computed with
/// integer math. Overflow guardrails: at APY_BPS=500 (5%) and elapsed=100
/// years, `principal * APY_BPS * elapsed_secs` stays comfortably within i128
/// for any realistic stablecoin quantity, so no saturating math needed.
fn appreciated(principal: i128, elapsed_secs: u64) -> i128 {
    if principal <= 0 || elapsed_secs == 0 {
        return principal.max(0);
    }
    let numerator = principal * APY_BPS * (elapsed_secs as i128);
    let interest = numerator / (BPS_SCALE * SECS_PER_YEAR);
    principal + interest
}

fn load_position(env: &Env, owner: &Address) -> Position {
    env.storage()
        .persistent()
        .get(&DataKey::Position(owner.clone()))
        .unwrap_or(Position {
            principal: 0,
            since: 0,
        })
}

fn store_position(env: &Env, owner: &Address, pos: &Position) {
    let key = DataKey::Position(owner.clone());
    if pos.principal <= 0 {
        env.storage().persistent().remove(&key);
        return;
    }
    env.storage().persistent().set(&key, pos);
    // TTL bump: ~1 year at 5s/ledger. USDY positions are long-lived by design
    // (that's the point of the yield-bearing token) so extend generously.
    env.storage()
        .persistent()
        .extend_ttl(&key, 6_048_000, 6_307_200);
}

/// Settle the position's appreciation into its principal and reset `since`
/// to now. Used by both deposit and redeem so the interest baseline is
/// fresh before adding or subtracting the new movement.
fn settle(env: &Env, owner: &Address) -> Position {
    let pos = load_position(env, owner);
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(pos.since);
    Position {
        principal: appreciated(pos.principal, elapsed),
        since: now,
    }
}

#[contract]
pub struct MockUSDY;

#[contractimpl]
impl MockUSDY {
    /// One-time setup. `underlying` is the SAC address of the stablecoin this
    /// mock accepts (Circle USDC on testnet). Callers deposit that asset in,
    /// receive USDY, and redeem it later for principal + accrued yield paid
    /// out from this contract's own underlying reserve.
    ///
    /// The contract must be pre-funded with underlying stablecoin before
    /// yielded redemptions can settle — a fresh Position has principal=0 so
    /// initial deposits cover their own principal on redeem, but the interest
    /// portion has to come from somewhere. For the demo, admin sends ~10k
    /// USDC to this contract's address at deploy time.
    pub fn init(env: Env, underlying: Address) {
        if env.storage().instance().has(&DataKey::Underlying) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Underlying, &underlying);
    }

    /// Pull `amount` underlying stroops from `from` and mint an equivalent
    /// USDY position. Any prior USDY balance on `from` is settled first —
    /// its appreciated value collapses into the new principal, and the
    /// yield clock resets to now for the merged position.
    ///
    /// `from.require_auth()` — the depositor authorizes both this call and
    /// the SAC transfer beneath it in the same tx envelope.
    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let underlying = load_underlying(&env);
        token::Client::new(&env, &underlying).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        let mut pos = settle(&env, &from);
        pos.principal += amount;
        store_position(&env, &from, &pos);
        Deposit {
            from: from.clone(),
            amount,
            principal_after: pos.principal,
        }
        .publish(&env);
    }

    /// Burn `amount` USDY from `from`'s position and transfer that many
    /// underlying stroops back to `from`. Settles the position first so the
    /// burn draws against the appreciated balance, not the stale principal.
    ///
    /// The interest portion of the redemption is paid from this contract's
    /// own underlying reserve. If the reserve runs dry, the SAC transfer
    /// panics — the contract owner (deploy admin) is expected to top it up.
    pub fn redeem(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut pos = settle(&env, &from);
        if pos.principal < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }
        pos.principal -= amount;
        store_position(&env, &from, &pos);
        let underlying = load_underlying(&env);
        token::Client::new(&env, &underlying).transfer(
            &env.current_contract_address(),
            &from,
            &amount,
        );
        Redeem {
            from: from.clone(),
            amount,
            principal_after: pos.principal,
        }
        .publish(&env);
    }

    /// Yield-inclusive USDY balance of `owner`. Read-only — Sobre polls this
    /// on every dashboard tick and the value ticks up between calls without
    /// any write happening on either side.
    pub fn balance_of(env: Env, owner: Address) -> i128 {
        let pos = load_position(&env, &owner);
        let elapsed = env.ledger().timestamp().saturating_sub(pos.since);
        appreciated(pos.principal, elapsed)
    }

    /// APY exposed as basis points (500 == 5.00%). UI reads this so it
    /// doesn't have to hardcode the rate — one source of truth if the
    /// pitch narrative shifts.
    pub fn apy_bps(_env: Env) -> i128 {
        APY_BPS
    }

    /// SAC address of the underlying stablecoin this mock wraps. Sobre reads
    /// this at earn_enable so it knows which token to pre-authorize for the
    /// USDY deposit transfer.
    pub fn underlying(env: Env) -> Address {
        load_underlying(&env)
    }
}

mod test;
