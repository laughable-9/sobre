---
name: sobre-contracts
description: Work on the Sobre Soroban smart contracts — Rust + soroban-sdk, the sobre (per-family wallet) and sobre-factory crates in contract/. Use when editing contract logic, adding/changing a contract method, writing contract tests, or building/deploying the wasm.
---

# Sobre Smart Contracts (Rust / Soroban)

The on-chain core in `contract/`. Two crates:

- `contracts/sobre/` — per-family wallet. Owns the envelope split rule, members,
  spending policy, pending approvals. The source of truth for all balances.
- `contracts/factory/` — `SobreFactory`: deploys a fresh per-family `sobre`
  instance via `deploy_v2` (constructor args in the same tx, no init race).

Compiled to `wasm32v1-none` with `soroban-sdk`. The contract is the trust
anchor — there is no backend DB, all state lives here.

## Deployed exports (the public surface clients depend on)

- **SobreContract:** `init`, `join_wallet`, `remove_member`, `set_wallet_name`,
  `close_wallet`, `upgrade`, `set_envelopes`, `set_envelope_names`,
  `set_policy`, `deposit`, `spend`, `approve_request`, `deny_request`,
  `get_state`.
- **SobreFactory:** `init`, `set_sobre_wasm`, `current_sobre_wasm`,
  `create_sobre`, `sobres_of_admin`.

Changing any signature is a **breaking change** for both `web/` and
`apps/mobile/` (their `lib/contract.ts` ScVal encoders are hand-written to
match). If you touch a signature, update the encoders in BOTH clients.

## Invariants to preserve

- **Three envelopes**, percentages sum to **100**. Slot 3 is permanently
  **Savings** and always policy-protected. Validate the sum on `init` /
  `set_envelopes`.
- **2-member cap** (admin + one). The cap is what enforces single-use invites.
- **Existing balances stay put** when the split changes — only future deposits
  use the new ratios.
- **Admin spends bypass the policy and execute immediately.** Member spends over
  the policy threshold create a pending request.
- **Token-agnostic:** `init` takes any SEP-41 token contract ID. Don't hardcode
  XLM. (USDC redeploy = one constructor arg, no code change — see the
  PDAX/MoneyGram doc.)
- Every state-changing action **emits an event** (`Deposit`, `Spend`,
  `RequestCreated`, `RequestApproved`, `RequestDenied`, `MemberJoined`,
  `MemberRemoved`, `WalletRenamed`, `EnvelopesRenamed`) — the activity feed and
  the only audit trail depend on these. New mutating method → new event.

## Soroban correctness rules

- **Auth:** require the right signer with `require_auth()` on the acting
  address. Admin-only methods must check admin; `deposit`'s `from` auth also
  authorizes the inner SEP-41 `transfer` sub-call.
- **Struct field / map key ordering is alphabetical** in the host's ScVal
  representation. The client encoders rely on this (`SpendPolicy`:
  `daily_limit` < `protected_envelopes` < `require_all_sigs`). Don't reorder a
  `#[contracttype]` struct's semantics without re-checking the encoders.
- **i128 for money** (stroops). Watch for overflow on splits — use checked
  arithmetic.
- **Upgrade model:** factory stores the canonical wasm hash; `set_sobre_wasm`
  swaps it for new deploys; each Sobre opts in via admin-only `upgrade()` →
  `update_current_contract_wasm` (same address, same storage, new code). Keep
  storage layout backward-compatible across upgrades.

## Build, test, deploy

```bash
cd contract
cargo test                              # run BEFORE and AFTER every change
stellar contract build --optimize       # produces the optimized wasm
```

- Tests live in `contracts/sobre/src/test.rs` and
  `contracts/factory/src/test.rs`. Every new method or branch needs a test;
  cover the policy gate, the 2-member cap, the percent-sum validation, and the
  pending-approval flow.
- Optimized wasm sizes today: sobre ≈ 22,836 bytes, factory ≈ 4,975 bytes.
  A large size jump means something bloated got linked in — investigate.
- Full deploy recipe (upload wasm → deploy+init factory → `create_sobre`) is in
  the README appendix "deploying your own factory." Stellar CLI 26.0.
- To point a client at a new factory, update `FACTORY_CONTRACT_ID` in
  `web/src/lib/config.ts` **and** `apps/mobile/src/lib/config.ts`.

## Security review

Treat contract changes as security-sensitive (it custodies real funds on
mainnet). Run the `/security-review` skill on contract diffs, focusing on auth
gaps, integer overflow in splits, and policy-bypass paths.