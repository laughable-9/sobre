# Sobre

> A joint financial wallet for OFW families. Remittances arrive on Stellar, auto-split into household envelopes by an admin-set percentage, and stay visible to both members in real time.

Built for the [Rise In × Stellar APAC Hackathon](https://www.risein.com/programs/build-on-stellar-philippines-hackathon) (Philippines track), 2026.

---

## The problem

Filipino Overseas Foreign Workers (OFWs) send home **$35.6B** in remittances per year (7.3% of national GDP), yet:

- **96%** is consumed by food and basic household needs, leaving nothing for savings
- **8 in 10** OFWs return home with no savings after years working abroad
- **1 in 5** OFW-dependent families regularly runs out of money before the next remittance arrives; 72% of them respond by calling the OFW for more
- **25%** of remittances go directly to loan repayments

The money lands as a single lump sum into one bank account. No structure, no agreement, no shared plan. By the time anyone notices what was spent on what, it is too late.

## What Sobre does

```
                                   ┌─────────────────────────────────────┐
                                   │  Smart contract on Stellar         │
                                   │                                     │
   ┌─────────────────┐             │   ┌─────────┐                       │
   │ OFW sends       │   deposit() │   │   100   │  Auto-split by % set  │
   │ 100 XLM         │────────────▶│   │   XLM   │  by admin (one tx)    │
   │ from abroad     │             │   └────┬────┘                       │
   └─────────────────┘             │        │                            │
                                   │   ┌────┴────┐                       │
                                   │   ▼    ▼    ▼                       │
                                   │ 50 XLM 30 XLM 20 XLM                │
                                   │ Groc.  Tuit. Savings                │
                                   └─────┬────┬────┬────────────────────-┘
                                         │    │    │
                                         ▼    ▼    ▼
                            ┌──────────────────────────────┐
                            │ Both members' dashboards     │
                            │ update within 2-3 seconds.   │
                            └──────────────────────────────┘
```

One transaction, one signature, one atomic state change visible to everyone in the family. No "where did the money go" conversations. No manual budgeting after the fact.

## Status

| Component | Status |
|---|---|
| Phase 1: contract skeleton (`init`, `get_state`) | ✅ on testnet |
| Phase 2: admin mutators (`add_member`, `set_envelopes`) | ✅ on testnet |
| Phase 3: `deposit` with atomic envelope split and event emission | ✅ on testnet |
| Phase 4: `spend` with member-gating, balance check, and Spend event | ✅ on testnet |
| Phase 5: Next.js dashboard with Freighter wallet integration | ✅ local (Vercel deploy after design polish) |
| Mainnet deployment | not started |

## Live on Stellar testnet

| | |
|---|---|
| Contract ID | `CA2VIMSA75A6BTLE2G4Y5DRFDBSXOXZCUFQR32VB5WGOTGSVFYV4FSQY` |
| Network | Test SDF Network ; September 2015 (testnet) |
| Explorer | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CA2VIMSA75A6BTLE2G4Y5DRFDBSXOXZCUFQR32VB5WGOTGSVFYV4FSQY) |
| Payment token | XLM native (Stellar Asset Contract `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) |
| Exports | `init`, `add_member`, `set_envelopes`, `deposit`, `spend`, `get_state` |
| Wasm size | 11,358 bytes |

You can interact with the deployed contract directly via the Stellar CLI:

```bash
# Read full wallet state (admin, members, percents, balances)
stellar contract invoke \
  --id CCIEFZGJAPN7WI43PHAKBYMUTVKUNUBQ3K5OFG5OFVSLD3EB227CYKSV \
  --network testnet --source YOUR_IDENTITY \
  -- get_state

# Deposit 10 XLM (the hero feature). Splits per the configured percentages
# and emits a Deposit event the dashboard listens to.
stellar contract invoke \
  --id CA2VIMSA75A6BTLE2G4Y5DRFDBSXOXZCUFQR32VB5WGOTGSVFYV4FSQY \
  --network testnet --source YOUR_IDENTITY \
  -- deposit --from YOUR_IDENTITY --amount 100000000

# Spend 2 XLM from the Groceries envelope (must be a wallet member).
# Emits a Spend event with topics (Spend, caller, envelope) for the
# dashboard's transaction feed.
stellar contract invoke \
  --id CA2VIMSA75A6BTLE2G4Y5DRFDBSXOXZCUFQR32VB5WGOTGSVFYV4FSQY \
  --network testnet --source YOUR_IDENTITY \
  -- spend --caller YOUR_IDENTITY --envelope Groceries \
     --amount 20000000 --memo '"groceries at SM"'
```

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Browser (Next.js dashboard, planned)                           │
│   ↑                                                            │
│   │ poll get_state every 2-3s     ↑ sign tx                    │
│   ▼                                │                           │
│ Stellar RPC ─────────────────────► Freighter wallet            │
│   │                                                            │
│   ▼                                                            │
│ Soroban smart contract (this repo) ───── token::Client ─────►  │
│                                                          XLM SAC│
│                                                          (or any│
│                                                          SEP-41)│
└────────────────────────────────────────────────────────────────┘
```

The Soroban contract is the **single source of truth** for wallet state: members, percentage split, per-envelope balances. The frontend reads via simulated RPC calls (no fees) and writes by submitting Freighter-signed transactions. Live updates come from polling `get_state` — simple, no event subscription plumbing required for a 2-day MVP.

## Token-agnostic design

The contract accepts **any SEP-41 token** as the `payment_token` argument at `init`. The demo runs on XLM (native, no trustlines required, available on every network). Switching to USDC, EURC, or any other Stellar-issued token is a one-argument change at deploy time — no contract recompilation or redeploy required.

```rust
// XLM (demo)
init(admin, "CDLZFC3SYJYDZT7K...", [50, 30, 20])

// USDC (production)
init(admin, "CCw2Xs...usdc...sac...", [50, 30, 20])
```

This means the same contract works for any stablecoin or token without code changes. USDC support is on the roadmap.

## Repo layout

```
contract/
  Cargo.toml                       Workspace
  contracts/sobre/
    Cargo.toml                     Crate (compiles to sobre.wasm)
    src/lib.rs                     Contract code: data model, init, mutators, get_state
    src/test.rs                    Unit tests (cargo test, in-memory host)
    test_snapshots/                Soroban testutils state snapshots
web/                               Next.js 16 dashboard
  src/app/                         Routes (single page, App Router, "use client")
  src/components/                  ConnectButton, BalancePanel, forms, TxFeed
  src/hooks/                       useFreighter, useWalletState, useInit,
                                   useDeposit, useSpend, useAddMember, useTxFeed
  src/lib/                         config (contract ID, RPC), contract helpers,
                                   formatters
sobre_productspec.pdf              Original product spec
```

The dashboard polls the contract every 3 seconds via Soroban's
`simulateTransaction` (read-only, no fees) and submits writes via
Freighter-signed transactions. Live transaction feed comes from
`server.getEvents()` polling.

## Running the web app

```bash
cd web
npm install        # first time only
npm run dev        # http://localhost:3000
```

Open the URL in a browser with [Freighter](https://www.freighter.app/)
installed and switched to **Testnet**. Click Connect Wallet, then
either initialize a new wallet (if the contract instance is fresh) or
deposit/spend if it's already set up.

## Running the contract

Requires:
- [Rust 1.95+](https://rustup.rs) with the `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- [Stellar CLI 26+](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) (`cargo install --locked stellar-cli` or use the install script)

```bash
git clone https://github.com/laughable-9/sobre.git
cd sobre/contract

# Build
stellar contract build

# Run the in-memory test suite
cargo test

# Optional: deploy your own copy to testnet
stellar keys generate alice --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sobre.wasm \
  --source alice --network testnet --alias sobre
stellar contract invoke --id sobre --source alice --network testnet \
  -- init \
  --admin alice \
  --payment_token $(stellar contract id asset --asset native --network testnet) \
  --percents '[50,30,20]'
stellar contract invoke --id sobre --source alice --network testnet -- get_state
```

## Tech stack

- **Smart contract**: Rust, `soroban-sdk` v25, target `wasm32v1-none`
- **CLI**: Stellar CLI 26.0
- **Frontend** (planned): Next.js 15, TypeScript, Tailwind, deployed to Vercel
- **Wallet** (planned): Freighter via `@stellar/freighter-api`
- **RPC SDK** (planned): `@stellar/stellar-sdk`

## Hackathon

- **Event**: Rise In × Stellar APAC Hackathon (Philippines track), 2026
- **Country demo**: May 23, 2026, PDAX Office, Manila
- **Repo author**: [@laughable-9](https://github.com/laughable-9)

## License

MIT — see `LICENSE` once added.
