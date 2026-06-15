# Sobre Design Guide

**Document type:** Design system reference for web and mobile
**Project:** Sobre — shared family wallet for OFW households

---

## Design philosophy

Sobre's visual identity is warm, trustworthy, and approachable — deliberately not "crypto" or "fintech-cold." The palette evokes home: cream paper, mango orange, palm green. The target user is a Filipino household, not a trader. Every screen should feel like a budgeting app a parent would trust, not a wallet app that intimidates them.

---

## Color tokens

These are defined in `web/src/app/globals.css` as CSS variables. For mobile, the same hex values should be defined as a shared design token file (JSON or TS) consumed by both the web Tailwind config and the React Native theme.

| Token | Value | Usage |
|---|---|---|
| `--sobre-bg` | `#FDFAF3` | App background — warm cream, not pure white |
| `--sobre-surface` | `#FFFFFF` | Cards, modals, elevated surfaces |
| `--sobre-surface-alt` | `#F4EDDC` | Secondary surfaces, muted backgrounds |
| `--sobre-primary` | `#E8923C` | Mango — primary CTA buttons, active states |
| `--sobre-primary-hover` | `#D67E28` | Hover/pressed state for primary buttons |
| `--sobre-primary-text` | `#FFFFFF` | Text on primary-colored buttons |
| `--sobre-accent` | `#2E6B4C` | Palm green — trust, success, savings envelope |
| `--sobre-accent-soft` | `#E8F0EA` | Light green background for accent elements |
| `--sobre-text-1` | `#1F1B16` | Primary text — near-black, warm tone |
| `--sobre-text-2` | `#6B5F50` | Secondary text — labels, captions |
| `--sobre-text-3` | `#A89888` | Tertiary text — placeholders, disabled |
| `--sobre-success` | `#2E6B4C` | Same as accent — confirmations |
| `--sobre-warning` | `#E8923C` | Same as primary — used for warning states |
| `--sobre-danger` | `#C44536` | Errors, destructive actions (remove member, close wallet) |
| `--sobre-border` | `#EDE3D2` | Default border color |
| `--sobre-border-strong` | `#D9CBB3` | Emphasized borders, dividers |

### Shadows

| Token | Value |
|---|---|
| `--sobre-shadow-sm` | `0 2px 8px rgba(31,27,22,0.04), 0 1px 2px rgba(31,27,22,0.06)` |
| `--sobre-shadow-md` | `0 8px 24px rgba(31,27,22,0.08)` |

On mobile, these map to platform shadow/elevation systems — `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` on iOS, `elevation` on Android. Keep the same warm-toned shadow color (`#1F1B16` at low opacity) rather than pure black, to stay consistent with the warm palette.

---

## Typography

| Role | Font | Usage |
|---|---|---|
| Body / UI | **Inter** | All UI text, labels, buttons, numbers |
| Headings | **Fraunces** (serif) | h1–h4, the brand's warm/editorial touch |

Weights used: 400, 500, 600, 700. Fraunces is used in both normal and italic styles for headings.

**Numbers** (balances, amounts) use `font-variant-numeric: tabular-nums` (the `.tabular` utility class) so digits align in columns — important for envelope balance displays that update in real time.

### Mobile font strategy

Both Inter and Fraunces are Google Fonts, available via `expo-font` or `@react-native-google-fonts`. Load the same weight set (400/500/600/700, Fraunces normal + italic) to keep visual parity with web.

---

## Border radius scale

| Token | Value | Usage |
|---|---|---|
| `--r-card` | `12px` | Cards, panels |
| `--r-btn` | `8px` | Buttons |
| `--r-input` | `6px` | Text inputs |
| `--r-pill` | `999px` | Pills, badges, the "Est. 4.5% APY" label |

shadcn's broader radius scale (`--radius-sm` through `--radius-4xl`, 6px–32px) is also available for component-level use via the `base-nova` shadcn style.

---

## Component library

The web app uses **shadcn/ui** with the `base-nova` style, Tailwind v4, `lucide-react` icons, and `class-variance-authority` for variants. Core primitives in `web/src/components/ui/`: `button`, `card`, `dialog`, `input`, `label`, `sonner` (toasts).

### Mobile equivalents

shadcn/ui components are React DOM (web-only) and do not run in React Native. For mobile, the recommended equivalent stack is:

| Web (shadcn) | Mobile equivalent | Notes |
|---|---|---|
| `button` | React Native `Pressable` + custom styling, or `react-native-paper` Button | Reuse the same color tokens and radius scale |
| `card` | `View` with shadow/elevation styling | Match `--r-card` and `--sobre-shadow-sm` |
| `dialog` | `react-native-modal` or React Navigation modal screens | Mobile dialogs are typically full-screen or bottom-sheet, not centered overlays |
| `input` | React Native `TextInput` with custom styling | Match `--r-input`, border colors |
| `sonner` (toast) | `react-native-toast-message` or Expo's notification banners | Same warm color palette for success/error states |
| `lucide-react` icons | `lucide-react-native` | Same icon set, drop-in equivalent exists |

The component **API shapes** (props, variants) can mirror the web versions even though the implementations differ — this keeps the mental model consistent for whoever builds the mobile screens.

---

## Layout patterns

### Dashboard structure (from `globals.css` / `.sobre-app`, `.sobre-topbar`)

```
┌─────────────────────────────────────┐
│ Topbar (sticky)                      │  ← logo, wallet name, member avatars
├─────────────────────────────────────┤
│                                       │
│  Summary card (total balance)        │
│                                       │
│  Envelope cards (Groceries, Tuition, │
│  Savings) — tappable, show balance    │
│                                       │
│  Activity feed (grouped by day)      │
│                                       │
└─────────────────────────────────────┘
        [FAB: Deposit / Spend / Cash Out]
```

On web this is a single scrolling column with a max-width of 1320px and a responsive topbar that collapses at 760px (`grid-template-columns: auto 1fr`). On mobile, this maps naturally to a single-screen scroll view — no responsive breakpoint logic needed since mobile is always narrow.

### Modals → mobile screens or bottom sheets

Web modals (`DepositModal`, `SpendModal`, `InviteModal`, `ProfileEditModal`, `CloseWalletModal`, `RemoveMemberModal`) should become:

- **Bottom sheets** for quick actions (Deposit, Spend, Cash Out) — matches mobile banking app conventions
- **Full-screen modal routes** for multi-step flows (Invite, Profile setup, Close wallet confirmation)

### FAB (Floating Action Button)

`web/src/components/sobre/Fab.tsx` already follows a mobile-native pattern — a FAB with mango primary color is directly portable to React Native using the same positioning and color tokens.

---

## Animation patterns

Defined as CSS `@keyframes` in `globals.css`:

| Animation | Purpose | Mobile equivalent |
|---|---|---|
| `sobre-hero-pulse` | Top banner attention pulse | `react-native-reanimated` fade + translateY |
| `sobre-celebrate` | Success celebration toast | Reanimated slide-down + fade, paired with haptic feedback (`expo-haptics`) |
| `sobre-env-pulse` | Envelope card glow on update | Reanimated `withSpring` box-shadow/border animation |
| `sobre-slide-in` | Element entrance | Reanimated `FadeInUp` / `SlideInUp` |
| `sobre-live-pulse` | "Live" indicator pulse (palm green) | Reanimated `withRepeat` opacity/scale loop |
| `sobre-fade-in` | Generic fade | Reanimated `FadeIn` |
| `sobre-pop-in` | Modal/element pop entrance | Reanimated `FadeIn` + `scale` spring |

`react-native-reanimated` covers all of these patterns with near-equivalent APIs. The palm-green "live" pulse (`sobre-live-pulse`) is particularly important to preserve on mobile — it's the visual cue that both family members are seeing the same real-time state, which is core to Sobre's value proposition.

---

## Iconography

`lucide-react` on web. Use `lucide-react-native` on mobile — same icon names, same visual style, no redesign needed.

---

## Accessibility and locale notes

- **Tabular numbers** for all currency figures — critical on mobile where balance changes need to be scannable at a glance
- **PHP currency formatting** — see `web/src/lib/format.ts` and `usePhpPerXlm.ts`. This formatting logic is pure TypeScript and portable to React Native without changes
- **Color contrast** — the warm palette (`#1F1B16` on `#FDFAF3`) meets WCAG AA for body text; verify any new accent colors against the cream background, not against white
- **Emoji avatars** — `EmojiPicker.tsx` is used for member profiles. Emoji rendering is consistent across iOS/Android system fonts, so this ports directly

---

## Bringing it together: shared design token package

To keep web and mobile visually identical, extract the color, radius, and typography tokens from `globals.css` into a shared JSON/TS file (e.g. `packages/design-tokens/`):

```ts
export const colors = {
  bg: "#FDFAF3",
  surface: "#FFFFFF",
  surfaceAlt: "#F4EDDC",
  primary: "#E8923C",
  primaryHover: "#D67E28",
  accent: "#2E6B4C",
  accentSoft: "#E8F0EA",
  text1: "#1F1B16",
  text2: "#6B5F50",
  text3: "#A89888",
  danger: "#C44536",
  border: "#EDE3D2",
  borderStrong: "#D9CBB3",
} as const;

export const radius = {
  card: 12,
  btn: 8,
  input: 6,
  pill: 999,
} as const;
```

Web's `globals.css` and the React Native theme both import from this single source, so any palette change updates both platforms at once. This fits naturally into the `packages/core` or a sibling `packages/design-tokens` workspace described in `docs/tech-stack-architecture.md`.
