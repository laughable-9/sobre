---
name: sobre-mobile
description: Build and modify the Sobre mobile app — Expo ~56 / React Native 0.85, React 19, TypeScript, Stellar SDK. Use when editing anything under apps/mobile/, porting a web screen to RN, adding a screen/component/hook, or working on the mobile wallet-signing problem.
---

# Sobre Mobile (Expo + React Native + Stellar)

The native client in `apps/mobile/`. Same Stellar contracts as web, rebuilt in
React Native because Freighter (a browser extension) does not exist on mobile.
Read `docs/tech-stack-architecture.md` for the full mobile plan before large
changes.

## Current state (be accurate about this)

- Entry is `apps/mobile/App.tsx` → loads fonts → shows an in-app `Splash`
  overlay (logo pop + fade, `src/components/Splash.tsx`) over `RootNavigator`,
  which switches `Landing ↔ Dashboard` via local state (no nav library yet).
  The Dashboard renders with `address={null} contractId={null}`. **There is no
  wallet-connect / signing flow yet** — that is the single biggest open piece
  (see "The mobile problem" in the architecture doc). Reads work; writes do not,
  because nothing can sign.
- Screens: `src/screens/` (`Landing`, `Dashboard`). Components in
  `src/components/`. Shared logic in `src/lib/`. Theme in `src/theme/`
  (`tokens.ts`, `responsive.ts`, `insets.ts`).

## Architecture rules

- **The `src/lib/` files mirror `web/src/lib/` deliberately.** `config.ts`,
  `contract.ts`, `format.ts`, `usePhpPerXlm.ts` are kept in sync with web. When
  you change shared contract/format/config logic, change BOTH or you'll drift.
  `apps/mobile/src/lib/config.ts` literally says "Mirrors web/src/lib/config.ts."
- **Contract I/O goes through `src/lib/contract.ts`** (same `invokeWrite` /
  `simulateRead` shape as web), not raw SDK calls in screens. The write path is
  inert until a signing backend is wired in.
- **No DOM, no Tailwind, no shadcn.** Use React Native primitives
  (`View`, `Text`, `Pressable`, `TextInput`, `ScrollView`, `StyleSheet`) and
  `lucide-react-native` for icons. The dashboard is a single scrolling
  `ScrollView`. No CSS-style breakpoints — instead size for the device range
  (see "Responsive sizing" below).
- **Styling = theme tokens.** Import from `src/theme/tokens.ts` (`colors`,
  radius). Never hardcode hex — these match the web palette. See the
  **sobre-design-system** skill for the web↔mobile token mapping (shadows →
  iOS `shadow*` / Android `elevation`, keep the warm `#1F1B16` shadow color).
- Fonts: Inter + Fraunces via `@expo-google-fonts/*`, loaded in `App.tsx`.
  `App.tsx` returns `null` until `fontsLoaded` — keep that guard.

## Stellar SDK in React Native (critical setup — already done, don't break)

- `App.tsx` MUST import these first, before anything else:
  ```ts
  import "react-native-get-random-values";   // crypto.getRandomValues polyfill
  import "react-native-url-polyfill/auto";    // URL polyfill for the SDK
  ```
  Removing/reordering these breaks `@stellar/stellar-sdk` at runtime.
- `metro.config.js` stubs `eventsource` to `{ type: "empty" }` because the
  SDK's root entry statically requires Horizon streaming (needs Node
  `url`/`http`/`https`, absent on RN). We only use Soroban RPC reads, so it's
  dead code. **Do not** import Horizon streaming APIs — it'll re-introduce the
  Node-builtin resolution failure.

## Responsive sizing (small phone ↔ large phone / tablet)

Layout reflows for free — that's the point of flex. The only things that break
across device sizes are *large fixed font sizes* (they clip on an iPhone SE,
look tiny on a tablet).

- **Structure with flex / `gap` / `paddingHorizontal` / percentage widths**, not
  absolute positions. Most of the app already does this; keep it that way.
- **Leave small fixed px alone** — icon tiles (`width: 32/36/40`), dots
  (`width: 3/6`), bar thicknesses. A 6px dot should be 6px on every device.
  Do NOT run these through the scaler.
- **Scale only large type** with `rs()` from `src/theme/responsive.ts`:
  `fontSize: rs(38)`. It scales toward the device-width ratio but only partway
  (default `factor` 0.5) and is clamped to ~0.85–1.3, so a Pro Max / tablet
  doesn't get an absurd headline and a small phone shrinks gracefully. Baseline
  is iPhone-14 width (390). Currently applied to: Landing headline, section
  `h2` (sectionStyles), ProblemStats `num`, FinalCTA heading, SummaryCard
  `total`, Splash logo + wordmark.
- **Safety net for single-line dynamic values** (a balance that could be huge):
  add `numberOfLines={1} adjustsFontSizeToFit` so RN auto-shrinks to fit.
  `AnimatedNumber` forwards both props. Don't use `adjustsFontSizeToFit` on text
  with a forced `{"\n"}` or nested `<Text>` runs — it's unreliable there; rely
  on `rs()` instead.

## Porting a web screen to mobile

1. Reuse the web hook's *logic* (state machine, contract call) but rebuild the
   *view* in RN primitives. Web modals become bottom sheets (quick actions:
   Deposit/Spend/Cash Out) or full-screen routes (Invite/Profile/Close) — see
   the design guide's "Modals → mobile screens" section.
2. Animations: web CSS `@keyframes` → `react-native-reanimated` equivalents
   (table in `docs/design-guide.md`). Preserve the palm-green "live" pulse —
   it's the core real-time-shared-state cue.
3. Read-only screens port first (no signing dependency); write actions wait on
   the wallet layer.

## The wallet-signing work (when asked to build it)

Per `docs/tech-stack-architecture.md`, recommended path is **Option A**:
Stellar Wallets Kit / WalletConnect-for-Stellar deep-linking to Lobstr/xBull.
The new piece is a `useWallet` hook that replaces web's `useFreighter` with the
same shape (connect, address, `signTransaction`) so `contract.ts`'s
`invokeWrite` only swaps its signing call. Option C (passkey smart wallets) is
the long-term onboarding fix — separate spike. Don't pick Capacitor (Option B);
it doesn't solve signing.

## Quality gate

```bash
cd apps/mobile
npx tsc --noEmit        # strict TS (tsconfig extends expo/tsconfig.base)
npm run start           # expo dev server; press i / a / w for ios/android/web
```

No lint or test setup exists yet — if you add one, mirror web's config style.
`npm run web` (react-native-web) is the fastest visual check on this machine.