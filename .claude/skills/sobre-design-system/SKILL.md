---
name: sobre-design-system
description: Sobre's visual design system — warm OFW-household palette, Inter/Fraunces type, radius/shadow tokens, and the web↔mobile token mapping. Use when styling any UI on web or mobile, picking colors/spacing/type, or keeping the two platforms visually consistent.
---

# Sobre Design System

Full reference: `docs/design-guide.md`. Web source of truth:
`web/src/app/globals.css`. Mobile source of truth:
`apps/mobile/src/theme/tokens.ts`.

## Philosophy (this drives every decision)

Warm, trustworthy, approachable — **deliberately not "crypto" or
"fintech-cold."** The user is a Filipino OFW household, not a trader. Every
screen should feel like a budgeting app a parent would trust. Cream paper, mango
orange, palm green. When choosing between a "techy" and a "homey" treatment,
pick homey.

## Color tokens — never hardcode hex, use the token

| Token | Hex | Use |
|---|---|---|
| bg | `#FDFAF3` | App background (warm cream, **not** pure white) |
| surface | `#FFFFFF` | Cards, modals |
| surfaceAlt | `#F4EDDC` | Secondary/muted surfaces |
| primary | `#E8923C` | Mango — primary CTAs, active states |
| primaryHover | `#D67E28` | Hover/pressed primary |
| accent | `#2E6B4C` | Palm green — trust, success, Savings envelope |
| accentSoft | `#E8F0EA` | Light green accent background |
| text1 | `#1F1B16` | Primary text (warm near-black) |
| text2 | `#6B5F50` | Secondary text, labels |
| text3 | `#A89888` | Placeholders, disabled |
| danger | `#C44536` | Errors, destructive (remove member, close wallet) |
| border | `#EDE3D2` | Default border |
| borderStrong | `#D9CBB3` | Emphasized borders, dividers |

success = accent green, warning = primary mango. **Check contrast against the
cream `bg`, not against white** — that's where new accent colors fail WCAG AA.

### Shadows
- `shadow-sm`: `0 2px 8px rgba(31,27,22,0.04), 0 1px 2px rgba(31,27,22,0.06)`
- `shadow-md`: `0 8px 24px rgba(31,27,22,0.08)`

Note the shadow color is warm `#1F1B16` at low opacity, **not pure black**. On
mobile map to iOS `shadowColor/Offset/Opacity/Radius` and Android `elevation`,
keeping the same warm shadow color.

## Typography

- **Body/UI:** Inter (all labels, buttons, numbers).
- **Headings (h1–h4):** Fraunces (serif) — the brand's warm/editorial touch,
  used normal and italic.
- Weights: 400 / 500 / 600 / 700.
- **Currency/amounts use tabular numerals** — `.tabular` class on web
  (`font-variant-numeric: tabular-nums`), the equivalent on mobile — so digits
  align as live balances tick. This is required for every balance display.
- Both fonts are Google Fonts; mobile loads them via `@expo-google-fonts/inter`
  and `/fraunces` in `App.tsx` (same weight set for parity).

## Radius

| Token | Value | Use |
|---|---|---|
| card | 12px | Cards, panels |
| btn | 8px | Buttons |
| input | 6px | Text inputs |
| pill | 999px | Pills, badges (e.g. the "Est. 4.5% APY" label) |

## Web ↔ mobile component mapping

shadcn/ui is web-only (React DOM). Mobile equivalents keep the same **prop/
variant shape** so the mental model carries over:

| Web (shadcn) | Mobile |
|---|---|
| `button` | `Pressable` + token styles |
| `card` | `View` + shadow/elevation (match radius + shadow-sm) |
| `dialog` | bottom sheet (quick actions) or full-screen route (multi-step) |
| `input` | `TextInput` + token styles |
| `sonner` toast | `react-native-toast-message` (same warm success/error colors) |
| `lucide-react` | `lucide-react-native` (same icon names, drop-in) |

## Animations (preserve intent across platforms)

CSS `@keyframes` in `globals.css` map to `react-native-reanimated` on mobile
(full table in the design guide). **Always preserve `sobre-live-pulse`** (the
palm-green "live" indicator) — it's the visual proof that both family members
see the same real-time state, which is the core of Sobre's value. Pair success
animations with `expo-haptics` on mobile.

## Keeping platforms in sync

The same hex values back both platforms. The long-term plan
(`docs/tech-stack-architecture.md`) is a shared `packages/design-tokens/` that
both web's Tailwind config and the RN theme import. Until that exists, a palette
change means editing **both** `web/src/app/globals.css` and
`apps/mobile/src/theme/tokens.ts` — don't let them drift.