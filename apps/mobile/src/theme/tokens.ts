/**
 * Sobre design tokens — mirrors the CSS variables in
 * web/src/app/globals.css (warm cream + mango + palm green).
 *
 * Keep this in sync with docs/design-guide.md. If the web palette changes,
 * update both places until a shared design-tokens package exists.
 */

export const colors = {
  bg: "#FDFAF3",
  surface: "#FFFFFF",
  surfaceAlt: "#F4EDDC",

  primary: "#E8923C",
  primaryHover: "#D67E28",
  primaryText: "#FFFFFF",
  /** Soft mango fill behind incoming-amount cards and the admin member
   *  avatar. Matches the web's #fbe7d2. */
  primarySoft: "#FBE7D2",

  accent: "#2E6B4C",
  accentSoft: "#E8F0EA",
  /** Text/elements sitting on the solid palm-green accent band. */
  onAccent: "#FFFFFF",
  onAccentMuted: "rgba(255,255,255,0.85)",

  /** "Approval required / Locked" pill — soft amber fill + deep amber text.
   *  Matches the web's #fdf3d8 / #b88b1c. */
  warningSoft: "#FDF3D8",
  warningText: "#B88B1C",

  text1: "#1F1B16",
  text2: "#6B5F50",
  text3: "#A89888",

  success: "#2E6B4C",
  warning: "#E8923C",
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

/**
 * Warm-toned shadow (not pure black) to match the web's
 * --sobre-shadow-sm / --sobre-shadow-md. React Native shadows need
 * explicit color/offset/opacity/radius rather than a CSS box-shadow string.
 */
export const shadows = {
  sm: {
    shadowColor: colors.text1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: colors.text1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/**
 * Envelope accent colors — Savings always uses the palm green accent,
 * the other two envelopes use the primary mango. Matches the web's
 * envelope card treatment.
 */
export const envelopeColors = {
  Groceries: colors.primary,
  Tuition: colors.primary,
  Savings: colors.accent,
} as const;
