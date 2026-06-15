# Sobre Tech Stack and Architecture

**Document type:** Architecture reference and mobile expansion plan
**Project:** Sobre — shared family wallet for OFW households

---

## Current stack (web)

| Layer | Technology | Notes |
|---|---|---|
| Smart contracts | Rust + `soroban-sdk` v25, compiled to `wasm32v1-none` | Two crates: `sobre` (per-family wallet) and `sobre-factory` (deploys instances) |
| Blockchain | Stellar (Soroban), mainnet + testnet | Reads via `simulateTransaction`, writes via signed transactions, events via `getEvents` |
| SDK | `@stellar/stellar-sdk` v15 | Transaction building, XDR encoding/decoding, RPC client |
| Wallet | `@stellar/freighter-api` v6 | Browser extension wallet — signs transactions, returns signed XDR |
| Frontend framework | Next.js 16 (App Router), React 19, TypeScript | `web/` directory |
| Styling | Tailwind v4, shadcn/ui (`base-nova` style) | Design tokens in `globals.css`, see design guide |
| State | React hooks, no global state library | Each contract action is its own hook (`useDeposit`, `useSpend`, etc.) |
| Hosting | Vercel | Edge functions for the PHP rate proxy |

### How the pieces connect today

```
Browser (Freighter extension)
  │
  ├─ reads: simulateTransaction → Soroban RPC → contract storage
  ├─ writes: build tx → Freighter signs → submit → poll for confirmation
  └─ events: getEvents → Soroban RPC → activity feed
```

All contract interaction logic lives in `web/src/lib/contract.ts` (`invokeWrite`, `simulateRead`) and is wrapped by per-action hooks in `web/src/hooks/`.

---

## The mobile problem

Freighter is a **browser extension**. It does not exist on iOS or Android. This is the single biggest blocker to a direct "same stack, different shell" mobile port — every hook that calls `signTransaction` from `@stellar/freighter-api` breaks on mobile with no substitute.

Everything else in the stack — `@stellar/stellar-sdk`, the contract logic, the RPC calls, the business logic in the hooks — is plain TypeScript and portable.

---

## Mobile architecture options

### Option A: React Native + WalletConnect-style wallet (recommended)

Rebuild the UI in React Native (or Expo), keep all of `web/src/lib/contract.ts` and the hooks largely intact, and swap the signing layer.

```
React Native app
  │
  ├─ @stellar/stellar-sdk (same package, works in RN with polyfills)
  ├─ contract.ts (same logic, swap signTransaction call)
  └─ signing: Stellar Wallets Kit / WalletConnect-for-Stellar
       → deep-links to a mobile wallet app (e.g. Lobstr, xBull)
       → wallet app signs, returns control to Sobre
```

**Why this fits:**
- Stellar has a mobile wallet ecosystem (Lobstr, xBull, Freighter mobile beta) that supports WalletConnect-style session signing
- `@stellar/stellar-sdk` runs in React Native with the standard crypto polyfills (`react-native-get-random-values`, buffer shims)
- The contract layer (`invokeWrite`, `simulateRead`, all the ScVal encoders) needs zero changes — only the signing call changes
- Most hooks (`useDeposit`, `useSpend`, `useSobreSummary`, etc.) are signing-agnostic and port with minor adjustments

**What changes:**
- `useFreighter.ts` → `useWalletConnect.ts` (or equivalent) — same shape, different signing backend
- All UI components rebuilt in React Native (no DOM, no Tailwind)
- Navigation: App Router → React Navigation

### Option B: Capacitor / WebView wrapper

Wrap the existing Next.js app in a Capacitor shell and ship it as an iOS/Android app.

**Why this is the fastest path:**
- Almost zero code changes — the web app already exists
- Capacitor provides native shells with access to device APIs if needed later

**Why this is risky for Sobre specifically:**
- Freighter still does not exist on mobile. The WebView cannot access a browser extension.
- Would still need the same wallet-signing replacement as Option A, just inside a WebView instead of native UI
- App store review is stricter on WebView-wrapped crypto apps — both Apple and Google have rejected wallet-adjacent WebView apps for insufficient native functionality

**Verdict:** Capacitor solves "ship an app" but does not solve the actual blocker (signing). Once the signing layer is solved, Option A gives a better native experience for the same signing work.

### Option C: Embedded / custodial signing (Passkeys or in-app key management)

Instead of relying on an external wallet app, Sobre manages keys itself using Stellar's smart wallet primitives (passkey-based signing, e.g. via `@stellar/typescript-wallet-sdk` or similar passkey contract patterns).

**Why this is worth considering for OFW families specifically:**
- The target users are not crypto-native. Asking them to install Freighter, Lobstr, or xBull and manage a seed phrase is a major onboarding barrier — arguably the single biggest one for this user base
- Passkey-based smart wallets (Face ID / fingerprint to sign) match how OFW families already use banking apps
- Stellar supports smart contract accounts that can be controlled by WebAuthn/passkey signatures instead of a traditional keypair

**Trade-off:** more contract work (a smart wallet contract per user, or per family), and it is a newer pattern with less tooling maturity than Option A.

**Recommendation:** Build Option A first (fastest to a working cross-platform app using the existing wallet ecosystem), and treat Option C as the long-term onboarding improvement once the core app is stable on mobile.

---

## Recommended path: incremental mobile rollout

1. **Extract the shared core into a package** — `@stellar/stellar-sdk` calls, `contract.ts`, ScVal encoders, and the business-logic portions of the hooks (everything except the signing call and the React-DOM-specific parts) move into a `packages/core` workspace that both `web/` and the new mobile app import.
2. **Stand up an Expo app** (`apps/mobile`) using the same monorepo. Expo gives a faster iteration loop than bare React Native and supports both iOS and Android from one codebase.
3. **Implement signing via Stellar Wallets Kit** (or direct WalletConnect-for-Stellar) — this is the only genuinely new piece of infrastructure.
4. **Port screens incrementally**, starting with the read-only dashboard (`useSobreSummary`, `useWalletState`, `ActivityFeed`) since these have no signing dependency — they work as soon as `contract.ts` runs in React Native.
5. **Port write actions last** (`deposit`, `spend`, `approve_request`, etc.) once signing is in place.

### Suggested monorepo layout

```
sobre/
├── contract/              # existing Rust contracts, unchanged
├── packages/
│   └── core/               # @stellar/stellar-sdk wrappers, ScVal encoders,
│                            # contract.ts, shared hooks (signing-agnostic parts)
├── web/                    # existing Next.js app, imports from packages/core
└── apps/
    └── mobile/              # Expo app, imports from packages/core
```

This requires converting `web/` and the new `packages/core` into a workspace (npm/pnpm workspaces), which is a structural change but does not require rewriting working code — only moving files and updating imports.

---

## What stays exactly the same regardless of mobile approach

- The Rust smart contracts — `sobre` and `sobre-factory` — do not change at all. Mobile clients call the same deployed contract addresses on the same network.
- The data model: envelopes, members, policy, pending requests — all defined on-chain, already platform-agnostic.
- `@stellar/stellar-sdk` for transaction building, simulation, and event polling.
- The PDAX and MoneyGram integrations (see `docs/pdax-moneygram-integration.md`) — these are server-side proxy routes and work identically regardless of which client calls them.

---

## Open questions for the mobile plan

1. **Which wallet ecosystem to target first** — Lobstr and xBull both have mobile apps with deep-link signing support. Confirming which has the more reliable React Native integration is the first technical spike.
2. **Expo vs bare React Native** — Expo is faster to start but some Stellar crypto polyfills may need a custom dev client (Expo's "prebuild" workflow) rather than the managed workflow. Needs a small spike to confirm.
3. **Passkey smart wallets (Option C)** — worth a separate research spike in parallel, since it directly addresses the onboarding friction that is the actual product risk for non-technical OFW families.
4. **App store policies** — both Apple and Google have specific rules for crypto/wallet apps (disclosures, KYC flows for fiat on/off-ramp via PDAX/MoneyGram). This needs review before submission, not after building.
