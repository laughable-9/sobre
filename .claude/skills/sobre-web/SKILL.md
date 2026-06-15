---
name: sobre-web
description: Build and modify the Sobre web app — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/base-ui, Stellar SDK + Freighter. Use when editing anything under web/, adding UI/hooks/contract calls, or wiring Soroban reads/writes from the browser.
---

# Sobre Web (Next.js 16 + Stellar)

The browser client in `web/`. Talks directly to the deployed mainnet Soroban
contracts via `@stellar/stellar-sdk`, signs with the Freighter extension, holds
no server-side state.

## Before you write code

- **Next.js 16 is NOT the Next.js in your training data.** Per `web/AGENTS.md`,
  read the relevant guide in `node_modules/next/dist/docs/` before using any
  App Router / routing / caching / `fetch` API. Heed deprecation notices. Do not
  assume `pages/`, `getServerSideProps`, or old caching defaults exist.
- React **19** — Server Components by default. Any file using hooks, Freighter,
  or browser APIs needs `"use client"` at the top (see every file in
  `web/src/hooks/` and `web/src/components/sobre/`).
- TypeScript strict. No `any` unless there's no alternative; prefer
  `unknown` + narrowing (see `WriteResult.returnValue` in `lib/contract.ts`).

## Architecture (match it, don't reinvent)

```
component (use client)
  → per-action hook (web/src/hooks/useX.ts)
    → invokeWrite / simulateRead (web/src/lib/contract.ts)
      → @stellar/stellar-sdk → Soroban RPC + Freighter
```

- **All contract I/O goes through `web/src/lib/contract.ts`.** Never call
  `rpc.Server`, `TransactionBuilder`, or `signTransaction` directly from a
  component or a new hook. Use `invokeWrite(contractId, method, args, addr)`
  for writes and `simulateRead<T>(...)` for reads.
- **One hook per contract action.** New contract method → new
  `web/src/hooks/useX.ts` modeled exactly on `useDeposit.ts`: `pending` /
  `error` / `lastHash` state, `useCallback`, guard `if (!userAddress)` /
  `if (!contractId)`, try/finally that always clears `pending`, surface the
  error message via `e instanceof Error ? e.message : String(e)`.
- **Encoding ScVals:** reuse the helpers in `contract.ts` (`envelopeScVal`,
  `percentsScVal`, `stringVecScVal`, `spendPolicyScVal`). When adding a struct
  arg, remember **Soroban sorts struct map keys alphabetically** — entries in
  the `scvMap` must be in alpha order (see `spendPolicyScVal`).
- **i128 amounts:** money is `bigint` in stroops, encoded
  `nativeToScVal(x, { type: "i128" })`. 1 XLM = `STROOPS_PER_XLM` (10,000,000).
  Never use `number` for on-chain amounts.
- **Reads / live state:** the dashboard polls `get_state` every 3s via
  `simulateRead`. New live data follows `useSobreSummary` / `useWalletState`.
  Events come from `useTxFeed` (RPC `getEvents`). Don't add a backend cache —
  there is no backend.
- **Config is centralized** in `web/src/lib/config.ts` (`FACTORY_CONTRACT_ID`,
  `NETWORK`, `XLM_SAC_ID`, `STROOPS_PER_XLM`, envelope labels). Never hardcode a
  contract ID, RPC URL, or passphrase in a component. The app is on **mainnet** —
  do not reintroduce testnet values.

## UI conventions

- shadcn/ui (`base-nova` style) over `@base-ui/react`, Tailwind v4,
  `lucide-react` icons, `class-variance-authority` for variants. Primitives live
  in `web/src/components/ui/` — reuse `Button`, `Card`, `Dialog`, `Input`,
  `Label`, `sonner` toasts. Don't add a competing component library.
- Use the design tokens, never raw hex. See the **sobre-design-system** skill
  and `web/src/app/globals.css`. Currency uses the `.tabular` class
  (`font-variant-numeric: tabular-nums`).
- Money formatting + PHP conversion is pure TS in `web/src/lib/format.ts` and
  `usePhpPerXlm.ts` — reuse, don't duplicate.
- Modals live in `web/src/components/sobre/` (`DepositModal`, `SpendModal`,
  `InviteModal`, …). Follow their structure for new flows.

## Quality gate (run before claiming done)

```bash
cd web
npm run lint        # eslint (eslint.config.mjs, eslint-config-next)
npx tsc --noEmit    # type check
npm run build       # catches RSC/client boundary + Next 16 build errors
```

`npm run dev` → http://localhost:3000. Requires Freighter on **Mainnet** to
exercise wallet flows. For verifying a real change end-to-end, use the `/verify`
or `/run` skills rather than eyeballing.

## Gotchas

- A missing `"use client"` shows up as a confusing RSC serialization error at
  build, not lint — when in doubt, `npm run build`.
- `STROOPS_PER_XLM` rounding: convert PHP→XLM→stroops at the edge, keep `bigint`
  internally; never `parseFloat` a balance.
- Invite links hardcode `APP_ORIGIN` so a link made on localhost still resolves
  to the deployed app — don't "fix" it to `window.location.origin`.