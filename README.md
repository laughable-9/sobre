# Sobre

> A joint financial wallet for OFW families. Remittances arrive on Stellar, auto-split into household envelopes by an admin-set percentage, and stay visible to both members in real time.

Built for the [Rise In × Stellar APAC Hackathon](https://www.risein.com/programs/build-on-stellar-philippines-hackathon) — Philippines track, demo May 23, 2026 at PDAX Office Manila.

## 🧩 Problem

Filipino Overseas Foreign Workers (OFWs) send home **$35.6B** in remittances per year — about **7.3% of national GDP** — yet the people on the receiving end systematically end up with nothing saved:

- **96%** of remittances is consumed by food and basic household needs
- **8 in 10** OFWs return home with no savings after years working abroad
- **1 in 5** OFW-dependent families regularly runs out of money before the next remittance arrives; **72%** of them respond by calling the OFW for more
- **25%** of remittances go directly to loan repayments

The money lands as a single lump sum into one bank account. No structure, no agreement, no shared plan. By the time anyone notices what was spent on what, the month is over.

## 🌟 Vision

Every Filipino household that depends on remittances has a clear, agreed-upon plan for the money before it arrives — and a shared, real-time view of what's actually happening with it. Savings becomes a default, not a discipline. The OFW earns less anxiety and the family at home earns less guesswork. Sobre is the smart-contract layer that makes that plan auditable and irreversible: percentages set once, deposits split atomically, balances visible to everyone in the household.

## 🎯 Purpose

We built Sobre because traditional financial tools treat the receiving family as one anonymous account holder. The reality is that an OFW remittance is *already* a multi-stakeholder transaction the moment it lands — it's groceries for mom, school fees for the youngest, savings for next year. The "where did the money go" conversation is the symptom of a missing primitive: a wallet that natively understands an envelope budget.

Stellar's cheap, fast settlement plus Soroban's programmable money let us put that primitive on-chain. The smart contract owns the split rule; no human has to remember to do the budgeting after the fact, and no spreadsheet has to be trusted by two people in two countries.

## 👥 Target Users

- **OFW remitters** abroad (Saudi, UAE, Hong Kong, Singapore, US) who want their hard-earned money to be auto-budgeted at the source instead of disappearing into a single bank balance
- **OFW-dependent households in the Philippines** — typically a spouse plus dependents — who want shared visibility into how the month's remittance has been split and spent
- **Future:** unbanked / underbanked Filipinos with no formal savings tooling, MSMEs receiving cross-border B2B payments that need split-by-category accounting

## ✨ Features

- **Auto-split on arrival** — A `deposit(from, amount)` contract call atomically distributes the payment across three named envelopes by admin-set percentages. One signature, one transaction, one consistent state change.
- **Custom envelope names** — Admin names the first two envelopes whatever the family actually budgets for (Rent, School, Vacation). The third is permanently the APY-bearing Savings envelope.
- **Shared dashboard** — Both members poll the contract every 3 seconds. Money arriving, money spent, percent splits, balances — all visible on both screens within seconds of any transaction landing.
- **Spending policy** — Optional admin-approval gate: require-all-sigs flag, per-member daily limit (with PHP/XLM toggle), and per-envelope protection. Savings is permanently admin-protected. Admin spends always bypass the policy.
- **Pending approvals** — When a member's spend hits the policy threshold, the contract creates a pending request the admin can approve or deny. Both actions emit events for the activity feed.
- **One-time invite links** — Admin generates a 30-minute, single-use invite URL for a second family member. Joining is one-click if the invitee already has a profile.
- **Live activity feed** — Real-time `Deposit`, `Spend`, `RequestCreated/Approved/Denied`, `MemberJoined`, and `MemberRemoved` events sourced from the contract via `getEvents`, grouped by day.
- **Token-agnostic contract** — `init` accepts any SEP-41 token contract ID. Demo runs on XLM via the native SAC; switching to USDC/EURC for production is a single deploy-time argument change.
- **Multi-Sobre per user** — A SobreFactory deploys a fresh per-family contract instance at `create_sobre`. Users can be admin of one family wallet and a member of another from the same Stellar address.

## 🛠️ Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui — deployed to Vercel
- **Smart contract:** Rust, `soroban-sdk` v25, compiled to `wasm32v1-none`. Two contracts: `SobreContract` (per-family wallet) + `SobreFactory` (deploys instances via `deploy_v2`)
- **Blockchain:** Stellar — Soroban (smart contracts), Stellar RPC (`simulateTransaction` for reads, `sendTransaction` for writes, `getEvents` for the activity feed), Stellar SDK (`@stellar/stellar-sdk` v15)
- **Wallet:** Freighter via `@stellar/freighter-api` v6
- **Other tools:** Stellar CLI 26, Friendbot for testnet funding, Vercel for hosting

## 🚀 How to Run Locally

```bash
git clone https://github.com/laughable-9/sobre.git
cd sobre

# Web app
cd web
npm install
npm run dev          # http://localhost:3000

# Contract (separate terminal, from repo root)
cd contract
stellar contract build
cargo test
```

The web app reads from the live testnet factory by default — open the URL in a browser with [Freighter](https://www.freighter.app/) installed and switched to **Testnet**, then click Connect Wallet and either open a new Sobre or paste an invite link.

To deploy your own copy of the contracts, see the commands at the bottom of this README.

## 🌐 Deployment

### Testnet

| | |
|---|---|
| **SobreFactory** | `CDDGY2WGKGTEV7477Y4N4PQF66LMST4LC3V5PONVPRUQOZBOFYL5UEEH` |
| **SobreContract wasm hash** | `1bb448b9824e4b4ca035b2f3877d168458080a9f10bb232f00f5f90a0de47133` |
| **Payment token** | XLM native SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Network passphrase** | `Test SDF Network ; September 2015` |
| **Factory explorer** | [stellar.expert/explorer/testnet/contract/CDDGY2WGKGTEV7477Y4N4PQF66LMST4LC3V5PONVPRUQOZBOFYL5UEEH](https://stellar.expert/explorer/testnet/contract/CDDGY2WGKGTEV7477Y4N4PQF66LMST4LC3V5PONVPRUQOZBOFYL5UEEH) |

📸 Screenshot — Stellar Expert (Testnet)
![Testnet Screenshot](./screenshots/testnet.png)

### Mainnet

| | |
|---|---|
| **SobreFactory** | `GXXXX...` (deploying for demo day) |
| **Payment token** | XLM native SAC (mainnet) |
| **Network passphrase** | `Public Global Stellar Network ; September 2015` |

📸 Screenshot — Stellar Expert (Mainnet)
![Mainnet Screenshot](./screenshots/mainnet.png)

## 🎥 Demo

- 🔗 **Live App:** _coming soon (Vercel deploy in flight)_
- 🎬 **Demo Video:** _coming soon_
- 🖼️ **Pitch Deck:** _coming soon_

## 👨‍💻 Team

| Name | Role | GitHub |
|---|---|---|
| Kyle Clarence | Lead developer (contract + frontend) | [@laughable-9](https://github.com/laughable-9) |

## 📜 License

MIT — see [`LICENSE`](./LICENSE).

---

## Appendix: deploying your own factory

```bash
cd contract
stellar contract build

# 1. Upload the SobreContract wasm — capture the hash from the output
stellar contract upload \
  --wasm target/wasm32v1-none/release/sobre.wasm \
  --source alice --network testnet

# 2. Deploy a fresh SobreFactory + init it with the wasm hash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sobre_factory.wasm \
  --source alice --network testnet --alias sobre_factory

stellar contract invoke \
  --id sobre_factory --source alice --network testnet \
  -- init --sobre_wasm <hash_from_step_1>

# 3. Open a Sobre via the factory (admin becomes the caller)
stellar contract invoke \
  --id sobre_factory --source alice --network testnet \
  -- create_sobre \
  --admin alice \
  --payment_token $(stellar contract id asset --asset native --network testnet) \
  --percents '[50,30,20]' \
  --envelope_names '["Groceries","Tuition","Savings"]' \
  --wallet_name '"Dela Cruz Family"' \
  --admin_name '"Juan Dela Cruz"' \
  --admin_emoji '"🥭"'
```

For the web app to point at your own factory, update `FACTORY_CONTRACT_ID` in `web/src/lib/config.ts`.
