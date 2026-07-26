#![no_std]
use soroban_sdk::{contract, contractclient, contractimpl, Address, Env};

// ─── Cross-contract clients (factory, per-family Sobre wallet) ─────────────

/// The one factory entrypoint the launcher drives. Typed via
/// `#[contractclient]` (the house pattern, see sobre's SoroswapRouter /
/// UsdyToken clients) so arg order and arity are checked at compile time
/// instead of trapping on-chain.
#[contractclient(name = "FactoryClient")]
pub trait Factory {
    fn create_sobre(env: Env, admin: Address, payment_token: Address) -> Address;
}

/// The two bootstrap methods the launcher calls on a freshly deployed
/// Sobre instance.
#[contractclient(name = "SobreWalletClient")]
pub trait SobreWallet {
    fn grow_enable(
        env: Env,
        caller: Address,
        pool_id: Address,
        xlm_asset: Address,
        soroswap_router: Address,
    );
    fn earn_enable(env: Env, caller: Address, usdy_contract: Address);
}

/// SobreLauncher — stateless one-transaction bootstrap for a new Sobre.
///
/// `SobreFactory.create_sobre` deploys + inits, but Grow and Earn each need
/// their own admin-signed call, so opening a Sobre from the web app cost
/// three passkey prompts. This contract chains all three behind a single
/// `admin.require_auth()` at the root: the admin's one auth entry covers the
/// whole invocation tree (factory create + grow_enable + earn_enable), so a
/// smart wallet signs once.
///
/// A separate crate rather than a factory change because the factory has no
/// upgrade entrypoint and every deployed Sobre pins the factory address for
/// its own `upgrade()` — extending the factory would mean redeploying it,
/// orphaning the live `AdminSobres` directory, and migrating every wallet's
/// factory pointer. The launcher is also deliberately stateless — no
/// storage, no init, no admin. The factory address arrives as an argument,
/// which keeps this a pure convenience wrapper: it can't be bricked, and a
/// caller who passes a bogus factory only hurts themselves. The factory
/// keeps recording `AdminSobres` and emitting `SobreCreated` exactly as
/// before, because it is still the thing doing the deploy.
#[contract]
pub struct SobreLauncher;

#[contractimpl]
impl SobreLauncher {
    /// Deploy a Sobre via `factory`, then enable Grow (Blend pool + XLM SAC
    /// + Soroswap router pins) and, when `usdy_contract` is provided, Earn —
    /// all inside one invocation. Returns the new Sobre's address.
    ///
    /// `usdy_contract: None` skips Earn for payment tokens the USDY wrapper
    /// can't back (its `underlying()` must match `payment_token`, and
    /// `earn_enable` traps on a mismatch).
    pub fn create_sobre_full(
        env: Env,
        admin: Address,
        factory: Address,
        payment_token: Address,
        pool_id: Address,
        xlm_asset: Address,
        soroswap_router: Address,
        usdy_contract: Option<Address>,
    ) -> Address {
        // Root auth entry. The nested `require_auth` calls inside
        // create_sobre / grow_enable / earn_enable match sub-invocations of
        // this entry's tree instead of demanding their own signatures.
        admin.require_auth();

        let sobre = FactoryClient::new(&env, &factory).create_sobre(&admin, &payment_token);

        let wallet = SobreWalletClient::new(&env, &sobre);
        wallet.grow_enable(&admin, &pool_id, &xlm_asset, &soroswap_router);
        if let Some(usdy) = usdy_contract {
            wallet.earn_enable(&admin, &usdy);
        }

        sobre
    }
}

mod test;
