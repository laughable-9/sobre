# Sobre

> A joint account for families living worlds apart.

Sobre is a shared family wallet for OFW households, built on Stellar. Each remittance is split atomically into named envelopes (e.g., Groceries, Tuition, Savings) the moment it lands, so both the OFW abroad and the family at home see the same balances update in real time.

Built for the [Rise In x Stellar APAC Hackathon](https://www.risein.com/programs/build-on-stellar-philippines-hackathon), Philippines track. Demo day: May 23, 2026, PDAX Office, Manila.

## 🧩 Problem

Philippine OFW households received a record $35.6 billion in remittances in 2025, equivalent to 7.3% of national GDP (BusinessWorld Online, 2026). Despite that scale, the money consistently fails to build lasting financial security at the receiving end.

Specifically:

- **96%** of remittances are consumed by food and basic household needs, leaving almost nothing for savings or goals (Inquirer News, 2023).
- **8 in 10** OFWs return home with no savings after years of working abroad (GMA News Online).
- **1 in 5** OFW-dependent families regularly runs out of money before the next remittance arrives, and **72%** of them respond by calling the OFW for more (Rappler, 2019).
- **25%** of remittances go directly to loan repayments, consuming the portion that should be building household assets (Ateneo de Manila University, 2020).
- Financial conversations between OFWs and their families are routinely avoided out of guilt, fear of conflict, and cultural pressure, which results in no shared plan and no accountability (CreditKaagapay, 2025).
- Guilt and distance drive OFWs to overspend on gifts, pasalubong, and unplanned requests, derailing whatever financial plan exists (AIA Philippines).

The money lands as a single lump sum into one bank account. No structure, no shared agreement, no real-time visibility. By the time anyone notices what was spent on what, the month is over.

## 🌟 Vision

Every Filipino household that depends on remittances has a clear, agreed-upon plan for the money before it arrives, and a shared real time view of what is actually happening with it. Savings becomes a default, not a discipline. The OFW earns less anxiety. The family at home earns less guesswork. Sobre is the on-chain primitive that makes that plan auditable and irreversible: percentages set once, deposits split atomically, balances visible to everyone in the household.

## 🎯 Purpose

We built Sobre because traditional financial tools treat the receiving family as a single anonymous account holder. The reality is that an OFW remittance is already a multi-stakeholder transaction the moment it lands. It is groceries for the spouse, school fees for the youngest, savings for next year. The "where did the money go" conversation is the symptom of a missing primitive: a wallet that natively understands an envelope budget.

Stellar's cheap, fast settlement plus Soroban's programmable money let us put that primitive on chain. The smart contract owns the split rule. No human has to remember to do the budgeting after the fact, and no spreadsheet has to be trusted by two people in two countries.

## 👥 Target Users

- **OFW remitters abroad** (Saudi, UAE, Hong Kong, Singapore, US) who want their money to be auto budgeted at the source instead of disappearing into a single bank balance.
- **OFW dependent households in the Philippines**, typically a spouse plus dependents, who want shared visibility into how the month's remittance has been split and spent.
- **Future:** unbanked and underbanked Filipinos with no formal savings tooling, plus MSMEs receiving cross border B2B payments that need split by category accounting.

## ✨ Features

Below is what currently runs on the deployed testnet contract + the local Next.js app.

- **Shared wallet with member link.** Admin opens a Sobre and shares a single use invite link with one family member. Cap of 2 members per wallet (admin + one).
- **Custom envelope names.** Admin names the first two envelopes whatever the family actually budgets for (Rent, School, Vacation, etc.). The third slot is permanently Savings, the APY bearing envelope.
- **Admin set percentage split.** Three envelopes, percentages sum to 100, set on creation and editable from Settings later. Existing balances stay put when the split changes; only future deposits use the new ratios.
- **Auto split on inflow.** A `deposit(from, amount)` contract call atomically distributes the payment across the three envelopes by the configured percentages, in one signed transaction.
- **Spending policy.** Optional admin approval gate: require all sigs flag, per member daily limit (PHP or XLM unit toggle), and per envelope protection. Savings is always protected. Admin spends always execute immediately and bypass the policy.
- **Pending approvals.** When a member's spend hits the policy threshold, the contract creates a pending request the admin can approve or deny from the dashboard. Both actions emit events into the activity feed.
- **Shared dashboard.** Both members poll `get_state` every 3 seconds via `simulateTransaction` and see the same total balance, per envelope balances, members list, and policy. Tabbed into Envelopes (live view) and Settings (admin controls).
- **Activity feed.** Live `Deposit`, `Spend`, `RequestCreated`, `RequestApproved`, `RequestDenied`, `MemberJoined`, `MemberRemoved`, `WalletRenamed`, and `EnvelopesRenamed` events pulled via the RPC `getEvents` endpoint and grouped by day.
- **One time, 30 minute invite links.** Each invite URL embeds a `expires=<unix>` parameter fixed at modal open time. Past or missing expiry routes to an "invite expired" screen. Admin can regenerate inside the modal. The 2 member cap naturally enforces the single use semantics: once the invitee joins, no one else can use the link.
- **Confirm only invite acceptance.** If the invitee already has a saved profile (name + emoji from first connect), accepting the invite is a single tap. The full name and emoji form only shows for first time users.
- **Close wallet.** Admin can sweep every envelope back to their address in a single SEP-41 transfer. Wallet stays callable for completeness, but the dashboard locks itself to a closed state.
- **Yield label.** Static "Est. 4.5% APY" pill on the Savings envelope (P2 placeholder per the product spec, no on chain yield strategy in this iteration).
- **Token agnostic contract.** `init` accepts any SEP-41 token contract ID. Demo runs on XLM via the native Stellar Asset Contract. Switching to USDC or EURC for a future deploy is one constructor argument with no code change.
- **Multi Sobre per user.** A `SobreFactory` deploys a fresh per family `SobreContract` instance at `create_sobre` via `deploy_v2`, with constructor args supplied in the same tx (no init race). The same Stellar address can be admin of one family wallet and a member of another.

### Not yet built (roadmap)

- USDC inflow path via Transak on ramp (P1 in the spec).
- MoneyGram Ramps off ramp (P1 in the spec).
- Real interest accrual on the Savings envelope (today's "4.5% APY" is a static label).
- Financial coach (P2 stretch in the spec).

## 🛠️ Tech Stack

- **Smart contracts:** Rust, `soroban-sdk` v25, compiled to `wasm32v1-none`. Two crates in `contract/`:
  - `sobre`: per family wallet contract.
  - `sobre-factory`: deploys per family instances via `deploy_v2`.
- **Blockchain:** Stellar testnet. Soroban for smart contracts, Stellar RPC for reads (`simulateTransaction`) and event polling (`getEvents`), Stellar SDK (`@stellar/stellar-sdk` v15).
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, in `web/`.
- **Wallet:** Freighter via `@stellar/freighter-api` v6.
- **Tooling:** Stellar CLI 26.0, Friendbot for testnet funding.

## 🚀 How to Run Locally

```bash
git clone https://github.com/laughable-9/sobre.git
cd sobre

# Web app (in one terminal)
cd web
npm install
npm run dev          # http://localhost:3000

# Contract tests (in another terminal, from repo root)
cd contract
cargo test
```

The web app talks to the live testnet factory by default, so once `npm run dev` is up you can open `http://localhost:3000` in a browser that has [Freighter](https://www.freighter.app/) installed and switched to **Testnet**, then connect and either open a new Sobre or paste an invite link.

## 🌐 Deployment

The wasm built with `stellar contract build --optimize` is deployed on both networks. Mainnet is the production deploy the web app talks to. Testnet stays live as a sandbox.

### Mainnet (production)

| | |
|---|---|
| **SobreFactory** | `CBXBBFCFVDGJANUAQUJG7I6YQ5YV7SSUM4QXB4ZCQYZ7VXAM4O3NIAUO` |
| **SobreContract wasm hash** | `545f5b8ad2c0c7c7e378d75b7d2d4060c3250259cb02700d53c4fe084d3b3da0` |
| **Payment token** | XLM native Stellar Asset Contract `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Network passphrase** | `Public Global Stellar Network ; September 2015` |
| **RPC** | `https://mainnet.sorobanrpc.com` |
| **Factory explorer** | [stellar.expert/explorer/public/contract/CBXBBFCFVDGJANUAQUJG7I6YQ5YV7SSUM4QXB4ZCQYZ7VXAM4O3NIAUO](https://stellar.expert/explorer/public/contract/CBXBBFCFVDGJANUAQUJG7I6YQ5YV7SSUM4QXB4ZCQYZ7VXAM4O3NIAUO) |

📸 Screenshot, Stellar Expert (Mainnet)
![Mainnet Screenshot](./screenshots/mainnet.png)

### Testnet (sandbox)

| | |
|---|---|
| **SobreFactory** | `CCPPCLVRQO7LPRHLGH7KXWZFSCXGODVZD7VAZOCV5JVDSWQ4NMZMBT2X` |
| **SobreContract wasm hash** | `7e10bb8904ff29d51ee40a60fca74758bd444825fb427086a83bd281b5a453ec` |
| **Payment token** | XLM native Stellar Asset Contract `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Network passphrase** | `Test SDF Network ; September 2015` |
| **RPC** | `https://soroban-testnet.stellar.org` |
| **Factory explorer** | [stellar.expert/explorer/testnet/contract/CCPPCLVRQO7LPRHLGH7KXWZFSCXGODVZD7VAZOCV5JVDSWQ4NMZMBT2X](https://stellar.expert/explorer/testnet/contract/CCPPCLVRQO7LPRHLGH7KXWZFSCXGODVZD7VAZOCV5JVDSWQ4NMZMBT2X) |

📸 Screenshot, Stellar Expert (Testnet)
![Testnet Screenshot](./screenshots/testnet.png)

**SobreContract exports:** `init`, `join_wallet`, `remove_member`, `set_wallet_name`, `close_wallet`, `upgrade`, `set_envelopes`, `set_envelope_names`, `set_policy`, `deposit`, `spend`, `approve_request`, `deny_request`, `get_state`. Wasm size 22,836 bytes (after `--optimize`).

**SobreFactory exports:** `init`, `set_sobre_wasm`, `current_sobre_wasm`, `create_sobre`, `sobres_of_admin`. Wasm size 4,975 bytes.

**Upgrade model:** the factory stores the canonical SobreContract wasm hash. Admin can call `set_sobre_wasm(new_hash)` to swap which wasm new families deploy with. Each existing Sobre stores the factory address and can opt into the latest hash via its own admin-only `upgrade()`, which calls Soroban's `update_current_contract_wasm` in place. Same contract address, same storage, new code. See [the upgrade rationale in the README appendix](#appendix-deploying-your-own-factory) for the industry pattern this implements.

### Live web app

`https://sobre-mocha.vercel.app` runs against the mainnet factory above. Real XLM, real wallets.

## 🎥 Demo

- 🔗 **Live App:** not deployed yet
- 🎬 **Demo Video:** not recorded yet
- 🖼️ **Pitch Deck:** in progress

## 👨‍💻 Team

**Team Legends**, UP Baguio 🦅

| Name | Role | GitHub |
|---|---|---|
| Clarence Kyle Pagunsan | Co-founder, lead developer (contract + frontend) | [@laughable-9](https://github.com/laughable-9) |
| Elfritz Angelo Peralta | Co-founder, project manager | [@elfrtz](https://github.com/elfrtz) |
| Lance Gabriel Sacdalan | Co-founder, QA | [@sacdalance](https://github.com/sacdalance) |

## 📜 License

MIT. See [`LICENSE`](./LICENSE).

## 📚 References

- AIA Philippines. (n.d.). *Financial guide for OFWs to protect your family's future.* https://www.aia.com.ph/en/about-us/aia-ph-blog/protection/financial-guide-for-ofws
- Ateneo de Manila University. (2020). *Overseas remittances: Saving the 'resilient' owners* (Policy Brief No. 2020-16). https://www.ateneo.edu/sites/default/files/2022-06/Policy%20Brief%202020-16.pdf
- BusinessWorld Online. (2026, February 17). *OFW remittances hit record $35.6B.* https://www.bworldonline.com/top-stories/2026/02/17/730931/ofw-remittances-hit-record-35-6b/
- CreditKaagapay. (2025, September 5). *Sacrifice and survival: Tackling family pressure and rising costs as a Filipino OFW.* https://www.creditkaagapay.com/2025/09/05/sacrifice-and-survival-tackling-family-pressure-and-rising-costs-as-a-filipino-ofw/
- GMA News Online. (n.d.). *8 money mistakes why OFWs are struggling financially.* https://www.gmanetwork.com/news/pinoyabroad/dispatch/609617/8-money-mistakes-why-ofws-are-struggling-financially/story/
- Inquirer News. (2023). *BSP data: OFW remittances go to food, basic needs.* Philippine Daily Inquirer. https://newsinfo.inquirer.net/2153866/bsp-data-ofw-remittances-go-to-food-basic-needs
- Rappler. (2019). *OFW remittances hit all-time high, but families still run out of cash, study.* https://www.rappler.com/business/247315-uniteller-study-ofw-remittances-hit-all-time-high-families-still-run-out-cash/

---

## Appendix: deploying your own factory

```bash
cd contract
stellar contract build

# 1. Upload the SobreContract wasm. Capture the hash from the output.
stellar contract upload \
  --wasm target/wasm32v1-none/release/sobre.wasm \
  --source alice --network testnet

# 2. Deploy a fresh SobreFactory and init it with the wasm hash.
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sobre_factory.wasm \
  --source alice --network testnet --alias sobre_factory

stellar contract invoke \
  --id sobre_factory --source alice --network testnet \
  -- init --sobre_wasm <hash_from_step_1>

# 3. Open a Sobre via the factory (admin becomes the caller).
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

To point the web app at your own factory, update `FACTORY_CONTRACT_ID` in `web/src/lib/config.ts`.
