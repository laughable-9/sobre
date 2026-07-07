# Sobre Design Guide — v2 (Green Board)

**Document type:** Design system reference for the v2 rebrand (web, mobile-ready)
**Project:** Sobre — shared family wallet for OFW households
**Status:** Live on the dashboard route (`/dashboard/[contractId]`), scoped under `.sobre-v2`. The rest of the app (landing, onboarding, invite) still runs the v1 cream/mango system in `design-guide.md` until the team promotes these tokens to `:root`.
**Source of truth:** the brand board (Sections 04 Color / 05 Typography / 07 UI Preview) and `web/src/app/globals.css` (the `.sobre-v2` block near the end of the file).

---

## Design philosophy

v2 is **crisp ink-on-white fintech with one vivid green** — professional, native-app-first, and trustworthy. Green appears *flat and saturated* where the board uses it (primary blocks, icon chips, success); everything else is near-black ink on pure white.

Two deliberate anti-goals:

1. **Not "crypto-cold"** — same as v1. The user is a Filipino OFW household.
2. **Not Tarsi.** Tarsi (a budget-tracker in the same space) reads as *soft sage*: green-washed grays, tinted panels, gradient banners. v2 must never drift there. Concretely: **neutrals stay neutral** (no green cast in grays/borders/muted text), and **green blocks are flat** (no gradients). The `.sobre-v2` token block in `globals.css` carries a comment enforcing this — keep it.

When choosing between treatments, pick the one that looks like a **native wallet app** (single column, tiles, cards on one rhythm), not a web dashboard.

---

## Color tokens

Defined in `web/src/app/globals.css` inside the `.sobre-v2` scope. Hexes come from the brand board Section 04 — do not invent adjacent shades; if a new tint is needed, derive it from a board color and tokenize it.

### Brand

| Token | Value | Board name | Usage |
|---|---|---|---|
| `--sobre-primary` | `#22A45C` | Green 600 | Primary CTAs, the balance hero, active states |
| `--sobre-primary-hover` | `#0F6B3A` | Green 700 | Hover/pressed primary; icon color on Green-50 chips |
| `--sobre-primary-bright` | `#3BC176` | Green 500 | Bright accents — the third split-bar color |
| `--sobre-accent` | `#0F6B3A` | Green 700 | Trust green on tints (dark enough for AA on Green 50) |
| `--sobre-accent-soft` | `#E8F5EE` | Green 50 | Icon chips, tinted rows, success pill backgrounds |

### Neutrals — must stay neutral

| Token | Value | Board name | Usage |
|---|---|---|---|
| `--sobre-bg` | `#FFFFFF` | (product call; board's Page BG is `#FAFAF7`) | Page background — full white |
| `--sobre-surface` | `#FFFFFF` | — | Cards, modals |
| `--sobre-surface-alt` | `#F4F4F2` | — | Muted surfaces, meta icon chips |
| `--sobre-text-1` | `#0F1A14` | Ink 900 | Primary text |
| `--sobre-text-2` | `#3D4A42` | Ink 700 | Secondary text, labels |
| `--sobre-text-3` | `#9C9C97` | — | Tertiary text, timestamps. **Neutral gray, not sage** |
| `--sobre-border` | `#E9E9E6` | — | Default borders. Neutral |
| `--sobre-border-strong` | `#D6D6D1` | — | Emphasized borders |
| `--sobre-cream` | `#F5E6C8` | Cream | The board's single warm accent — pending/review pill backgrounds |

> ⚠️ **The Tarsi guard:** the first v2 draft used green-tinted grays (`#E7EBE8` borders, `#8A948E` text, `#F0F4F1` surfaces) and a gradient hero — the combination read as Tarsi and was explicitly rejected. If a neutral looks slightly green next to `#9C9C97`, it's wrong.

### Semantic

| Token | Value | Board name | Usage |
|---|---|---|---|
| `--sobre-success` | `#1A8F52` | Success / CONFIRMED | Confirmations, inflow indicators, tracked-% bar |
| `--sobre-info` | `#2D6CA8` | Info / PENDING | Informational states |
| `--sobre-warning` | `#C68A2E` | Warning / REVIEW | Needs-attention states (2nd-approval pill dot) |
| `--sobre-danger` | `#C4443B` | Error / FAILED | Errors, destructive actions |
| `--sobre-danger-soft` | `#F9E4E2` | — | Soft tint behind danger copy (over-budget pill) |

### Shadows

| Token | Value |
|---|---|
| `--sobre-shadow-sm` | `0 2px 8px rgba(15,26,20,0.05), 0 1px 2px rgba(15,26,20,0.06)` |
| `--sobre-shadow-md` | `0 8px 24px rgba(15,26,20,0.09)` |
| hero glow | `0 8px 20px rgba(15,107,58,0.22)` — only on the green balance hero |

Shadow ink is `#0F1A14` (Ink 900) at low opacity — never pure black. On mobile, map to iOS `shadowColor/Offset/Opacity/Radius` and Android `elevation` with the same ink color.

**Rule:** every card uses `--sobre-shadow-sm` at rest. `--sobre-shadow-md` is reserved for the hover lift on quick-action tiles. Nothing else invents a shadow.

---

## ⚠️ Scoping mechanics — read before touching tokens

v2 is applied by putting `sobre-v2` on a route's root element (currently every branch of `/dashboard/[contractId]` — including the loading skeleton, so there is no cream→green flash).

**The alias gotcha (this bug shipped once):** the codebase maps tokens through alias variables (`--bg: var(--sobre-bg)`, `--text-1`, `--surface-alt`, plus the full shadcn set `--primary`, `--border`, `--muted`, …) declared on `:root`. CSS custom properties **compute at the element they're declared on** — the `:root` aliases bake in the *cream* values and descendants inherit those computed values. Overriding `--sobre-*` inside `.sobre-v2` does **not** re-evaluate them.

Therefore the `.sobre-v2` block **re-declares every alias** after the token overrides. If you add a new `--sobre-*` token or a new alias, add it to **both** the `:root` alias block *and* the `.sobre-v2` re-declaration list, or half the UI silently keeps the old theme.

**Promoting v2 app-wide** (when the team signs off): move the `.sobre-v2` token values onto `:root`, delete the re-declarations, and remove the `sobre-v2` class from the dashboard. The aliases then pick the new values up everywhere automatically.

**The residue neutralizer:** several v1 rules predate the token system and hardcode warm hexes (`.sobre-btn-soft:hover`, `.sobre-member .badge`, `.sobre-activity-item` tints, `.sobre-warning-bar`). A dedicated `.sobre-v2` override block corrects each one — if a mango/cream flash appears inside v2, the culprit is another pre-token hex; add it to that block (or better, tokenize the base rule).

---

## Typography

Board Section 05. Three families, three jobs — loaded via `next/font/google` in `web/src/app/layout.tsx` (`--font-manrope`, `--font-sans`/Inter, `--font-geist-mono`), never from a CDN.

| Role | Font | Weights | Usage |
|---|---|---|---|
| Display | **Manrope** | 600–800 | Headings, the hero balance figure, the wallet-name page title |
| Body / UI | **Inter** | 400–600 | All running text, buttons, form labels |
| Numeric + micro-labels | **Geist Mono** | 400–600 | Running numerals (sub-lines, envelope amounts, stats) AND every uppercase micro-label |

### How the heading swap works

Inside `.sobre-v2`, `--serif` and `--font-serif` are overridden to Manrope. Every v1 heading style referenced `var(--serif)` (Fraunces), so **all headings flip to Manrope automatically in scope** — no per-component font declarations. Do not hardcode `font-family: Fraunces` or `Manrope` in components; ride the variable.

### The micro-label system

The board writes its own section labels ("SECTION 04 — COLOR SYSTEM") in mono tracked caps. v2 unifies every section micro-label on that treatment via one rule in `globals.css`:

```
Geist Mono · 11px · weight 500 · letter-spacing 0.08em · uppercase
```

Covers: the hero's `TOTAL BALANCE` label, `THIS MONTH`, `RECENT ACTIVITY`, `MEMBERS (1/2)`, and the quick-action tile names (tiles use 10.5px / 0.06em). Add any new section label to the shared selector list — don't restyle one-off.

### Where Manrope vs Geist Mono for numbers

- **Hero balance figure** → Manrope 800, tight tracking (`-0.01em`), `font-variant-numeric: tabular-nums`. It is a *display* number (board Section 07 shows `$690` in heavy display type). It deliberately does **not** carry the `.tabular` class.
- **Everything else numeric** → Geist Mono via the scoped rule on `.tabular`, `.sobre-total`, `.sobre-env-amount`. Any new balance/amount surface gets the `.tabular` class and inherits mono automatically.

### Mobile font strategy

All three are Google Fonts: `@expo-google-fonts/manrope`, `/inter`, and Geist Mono (Vercel; available packaged or bundle the TTFs). Load the same weight sets for parity.

---

## Border radius scale

Two-step system — outer 16, inner 12:

| Level | Value | Usage |
|---|---|---|
| Outer cards | `16px` | Balance hero, quick-action tiles, This-month card, members card, split card wrapper |
| Inner elements | `12px` | Split rows, signal pills, activity icon chips (9–13px family), see-all button (10px) |
| Icon chips | `9–13px` | 26–44px square chips scale radius with size |
| Pills | `999px` | Back pill, currency toggle, badges |

The v1 tokens (`--r-card` 12px etc.) still exist for legacy components; v2 surfaces use the 16/12 system explicitly. **Vertical rhythm:** the wallet column's `16px` gap is the *only* vertical spacing between cards — components must not carry their own top/bottom margins (the This-month card's margin is zeroed in scope). Inner grids use `12px` gaps.

---

## Layout: the native wallet home

`/dashboard/[contractId]` (the `home` view) is a **single centered column, max-width 640px** — a phone screen that happens to be on desktop. No side rails, no multi-column grid.

```
┌──────────────────────────────────────┐
│ SiteHeader (sticky)                   │ ← brand · PHP|USD toggle · wallet menu
├──────────────────────────────────────┤
│ ‹ My Sobres                           │ ← BackLink pill (context-aware)
│                                        │
│ Family Wallet ✎                       │ ← wallet-name page title (Manrope 700,
│                                        │    clamp 28–38px, admin pencil → dialog)
│ ┌──────────────────────────────────┐ │
│ │ TOTAL BALANCE          (green)    │ │ ← BalanceHero: flat Green 600,
│ │ ₱12,345.67                        │ │    Manrope-800 figure, mono sub-line
│ │ 0.0000 XLM · 3 envelopes          │ │
│ │ ┌ Groceries ────────── ₱0.00 ┐   │ │ ← EnvelopeSplitCard nested inside:
│ │ │ ▂▂▂▂▂▂▂▂▂▂ (50%)            │   │ │    white rows on green, share bars
│ │ └──────────────────────────────┘   │ │    in Green 600/700/500
│ └──────────────────────────────────┘ │
│ [ADD MONEY][CASH OUT][LOG EXP][ENV.] │ ← QuickActions: 4-per-row tiles
│ [INVITE][SUPPLEMENTARY][SETTINGS]    │    (mono-caps names, Green-50 chips)
│ ┌──────────────────────────────────┐ │
│ │ THIS MONTH                        │ │ ← HouseholdSummary: 3 stats +
│ │ Deposited · Logged · Tracked %    │ │    progress bar
│ │ RECENT ACTIVITY (3 latest rows)   │ │ ← mini feed + placeholder pills
│ │ [See all activity ›]              │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ Daily limit · MEMBERS · supp.     │ │ ← SummaryCard (hideBalance) +
│ │ Pending approvals (when any)      │ │    pending approvals as children
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### Navigation: tiles are the nav (no tab bar)

The v1 tab bar is deleted. The quick-action tiles both act and navigate; sub-views are hash-synced so refresh and deep links work:

| View | Hash | Reached by | Container |
|---|---|---|---|
| `home` | *(none)* | default | centered column, max-width 640 |
| `envelopes` | `#envelopes` | ENVELOPES tile / split-row tap | centered, max-width 760 — full `EnvelopeCard`s |
| `activity` | `#activity` | "See all activity" button | centered, max-width 760 — full `ActivityFeed` with all resume/cancel handlers |
| `subaccounts` | `#subaccounts` | SUPPLEMENTARY tile | `SubAccountsPanel` |
| `settings` | `#settings` | SETTINGS tile | settings forms |

**Back rule: one back affordance per screen, pointing at the immediate parent.** Home shows `‹ My Sobres` (→ `/dashboard`); every sub-view shows `‹ Wallet` (→ home). Never stack two back pills.

Modals (not views): Add money (PDAX deposit), Cash out, Invite, **Log expense** (the off-chain note field with its 10-second undo), **Rename wallet**.

---

## Component inventory (v2 surfaces)

All in `web/src/components/sobre/`. Every component is `"use client"`, token-only styling, additive props.

### `BalanceHero`
Flat Green-600 card (never a gradient — Tarsi guard), 16px radius, green glow shadow. `TOTAL BALANCE` micro-label (mono caps, white 85%), Manrope-800 figure that follows the **app-wide currency toggle** (`useCurrency`), mono sub-line (`0.0000 XLM · 3 envelopes`). Accepts `children` — the split card nests here.

### `EnvelopeSplitCard`
Board Section 07's split rows. One row per envelope: white row (on green), 30px Green-50 chip with the envelope icon, name, right-aligned mono amount (currency-aware), and a 6px share bar whose width = the envelope's split percent. Bar colors cycle `Green 600 → 700 → 500`. Rows are buttons → envelopes view.
> The bar track `<span>` carries `display:block` in CSS with a "load-bearing" comment — inline spans ignore height and the bars vanish. Don't remove it.

Also exports **`HomeSignalsPlaceholder`** — the three notification pills. **One hue by design:** every pill rides Green 50 with ink text, no per-severity colors or dot prefixes (both were tried and rejected as too colorful — severity reads from the copy). **Static sample copy**, marked PLACEHOLDER in a header comment with the wire-up plan (Deposit event / `pendingRequests` / spend-vs-split). Remove or wire before launch.

### `QuickActions`
Fixed `repeat(4, minmax(0,1fr))` grid (wraps 4+3 — never auto-fit; long labels wrap two lines instead of stretching their tile). Tile: **the whole card rides Green 50** with a Phosphor `weight="fill"` icon in Green 700 and a Green-700 mono-caps name — no inner chip box, no border (a white-card-with-chip version and a multicolor chip cycle were both tried and rejected). Disabled tiles go neutral (`surface-alt` + `text-3`). Hover: `-1px` lift + `shadow-md` + chip `scale(1.07)`; press: `scale(0.97)`. Invite renders only for admins; Cash out disables at zero balance.

### `HouseholdSummary` ("This month" card)
Three stats (Deposited — currency-aware; Logged notes; Spending tracked % with a Success-green progress bar), then `RECENT ACTIVITY`: the **3 latest** feed events as compact **Green-50 rows** (bare Green-700 icon — no chip box or tone tints, one-line description, `relativeTime` stamp), a `children` slot (the placeholder pills live here), and a full-width "See all activity ›" button. Event copy comes from a local `describeEvent` switch — extend it when new `FeedEvent` kinds appear. The empty state is warm, not bare: an envelope chip + "Your family's story starts with the first deposit."

### `RenameWalletModal`
Opened by the pencil next to the wallet-name title (admin only). Input with **40-char hard cap + live counter** (danger color at the limit), Enter saves / Esc closes, Cancel + "Save name" finalize. Drives the existing `useRenameWallet` hook. The display title also ellipsizes as a second guard.

### `SiteHeader` / `TopBar` / `BackLink` / `CurrencyToggle`
Shared shell (`SiteHeader`) used by the landing nav and the app `TopBar`; wrapped in a named React `<ViewTransition>` (`experimental.viewTransition` in `next.config.ts` — degrades gracefully) so `/` ↔ `/dashboard` morphs the header. The dashboard TopBar shows brand + **global PHP|USD toggle** (`CurrencyContext`, sessionStorage-backed) + wallet menu; the wallet-name pill is **not** rendered there (it moved onto the page title). `BackLink` is the single back-pill component everywhere.

### `SummaryCard` (v1 component, v2 role)
Gets `hideBalance` — the balance + deposit/cashout buttons render in the hero/tiles instead, and the card keeps daily limit, members (invite/kick), the sub-accounts mini-list, and pending approvals via `children`. Never delete those sections; they have no other home.

---

## Iconography

**Phosphor** (`@phosphor-icons/react`, MIT) on the v2 dashboard — chosen over lucide for its solid style and over Hugeicons because Hugeicons' solid variants are Pro/paid. Weight policy: **`weight="fill"` for feature icons** (tile chips, stat chips, envelope icons), **`weight="bold"` for small control glyphs** (carets, check, close, copy, plus). No `strokeWidth` prop — that's a lucide-ism.

Established pairs: Add money `ArrowLineDown`, Cash out `ArrowLineUp`, Log expense `PencilSimpleLine`, Envelopes `EnvelopeSimple`, Invite `UserPlus`, Supplementary `UsersThree`, Settings `GearSix`, rename `PencilSimple`, back `CaretLeft`, warning `Warning`, savings `Plant`, APY `TrendUp`, undo `ArrowUUpLeft`.

Mobile: `phosphor-react-native` — same icon names and weight prop, preserving the web↔mobile parity story. **Migration status:** v2 dashboard surfaces are Phosphor; the long tail (modals, landing, mockups, onboarding) still imports `lucide-react` — swap opportunistically as those surfaces get touched.

---

## Animation

v1's keyframes still apply (`sobre-live-pulse` remains sacred — see `design-guide.md`). v2 adds:

| Pattern | Spec |
|---|---|
| Home entrance | wallet column wrapped in the existing `Reveal` component with `data-stagger` — cards cascade in (nth-child delays extended to 6). Reduced-motion strips it |
| Split / tracked bars | `sobre-bar-grow` keyframes — bars grow from 0 to their share on mount (0.7s ease-out, `backwards` fill) |
| LIVE badge | white dot on the hero runs `sobre-live-pulse` (the sacred real-time indicator) beside a mono-caps `LIVE` label |
| Hero motif | flat Green-700 concentric circles at low opacity via `::before` — decorative, `pointer-events: none`, never a gradient |
| Tile hover / press | `translateY(-1px)` + `shadow-md` + chip `scale(1.07)` hover; `scale(0.97)` press |
| Split-row hover / press | `brightness(0.98)` hover; `scale(0.985)` press |
| Tracked-% updates | `width 300ms ease` |
| Header route morph | React `<ViewTransition name="sobre-header">` on navigations |

Keep transitions at 120–300ms ease; no springs/bounces on web. **All v2 motion is stripped under `prefers-reduced-motion`** — the strip list sits beside the landing's in `globals.css`; add any new animated selector to it.

---

## Accessibility and locale

- **Contrast is now checked against pure white** (v1 checked against cream). Ink 900/700 pass AA easily; `--sobre-text-3` (`#9C9C97`) is for non-essential text only. On green: white passes; white-at-85% is for the label tier only.
- `--sobre-accent` is Green **700** (not 600) specifically so green text on Green-50 tints stays AA.
- **Tabular numerals everywhere balances render** — Geist Mono is monospaced, which covers it; the hero uses `font-variant-numeric: tabular-nums` on Manrope.
- **Currency**: every balance follows the global PHP|USD toggle (`useCurrency`); conversion stays in `lib/format.ts` / `PHP_PER_USDC`. `relativeTime` also lives in `lib/format.ts` — don't re-implement it.
- The wallet-name title ellipsizes + the rename input caps at 40 chars, so user content can't break the layout.

---

## Placeholders — current inventory

Anything rendering sample data is marked `PLACEHOLDER` in code comments at the component, the call site, and the CSS block:

| Placeholder | Where | Wire-up plan |
|---|---|---|
| "split fired" pill | `HomeSignalsPlaceholder` | latest `Deposit` event from `useTxFeed` |
| "needs 2nd approval" pill | 〃 | `usePendingSpendRequests` |
| "over budget" pill | 〃 | envelope spent-vs-split from the feed |

The board's mono rail meta ("FEE < 0.5% …") was cut by product decision — don't reintroduce it.

---

## Migration path

1. **Now:** v2 lives under `.sobre-v2` on the dashboard route only. Landing/onboarding/invite are v1 cream.
2. **Promote:** move the v2 values onto `:root`, delete the alias re-declarations, drop the `sobre-v2` class. All other screens re-skin instantly (their components already ride the tokens).
3. **Mobile / shared tokens:** extract to `packages/design-tokens/`:

```ts
export const colors = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceAlt: "#F4F4F2",
  primary: "#22A45C",
  primaryHover: "#0F6B3A",
  primaryBright: "#3BC176",
  accent: "#0F6B3A",
  accentSoft: "#E8F5EE",
  text1: "#0F1A14",
  text2: "#3D4A42",
  text3: "#9C9C97",
  success: "#1A8F52",
  info: "#2D6CA8",
  warning: "#C68A2E",
  danger: "#C4443B",
  dangerSoft: "#F9E4E2",
  cream: "#F5E6C8",
  border: "#E9E9E6",
  borderStrong: "#D6D6D1",
} as const;

export const radius = { card: 16, inner: 12, btn: 10, pill: 999 } as const;
```

4. **Until then**, a palette change means editing the `.sobre-v2` block (tokens **and** aliases) in `web/src/app/globals.css`.

---

## Do / Don't quick sheet

| ✅ Do | ❌ Don't |
|---|---|
| Flat Green 600 blocks | Green gradients (reads as Tarsi) |
| Neutral grays (`#9C9C97`, `#E9E9E6`) | Sage/green-tinted neutrals |
| Board hexes, tokenized | Inventing adjacent shades inline |
| Mono tracked caps for every micro-label | Mixed label treatments |
| Manrope for the hero figure | Mono for display-size numbers |
| One 16px column gap for rhythm | Per-card margins |
| Tiles + hash views for navigation | Re-adding a tab bar |
| One `BackLink` to the immediate parent | Stacked back pills |
| `--sobre-shadow-sm` on cards | Custom one-off shadows |
| Add new aliases to BOTH `:root` and `.sobre-v2` | Assuming `var()` chains re-evaluate in scope |
