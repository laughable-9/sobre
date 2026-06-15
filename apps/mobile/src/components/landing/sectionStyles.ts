/**
 * Shared styles for landing sections so each section component doesn't
 * redeclare the same section padding, heading, emphasis, and lede styles.
 * Section-specific styles still live in each component's own StyleSheet.
 */

import { StyleSheet } from "react-native";

import { rs } from "../../theme/responsive";
import { colors } from "../../theme/tokens";

export const sectionStyles = StyleSheet.create({
  section: {
    paddingHorizontal: 20,
    paddingVertical: 40,
    gap: 12,
  },
  /** Cream-tinted alternating section background. */
  alt: {
    backgroundColor: colors.surfaceAlt,
  },
  h2: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: rs(26),
    lineHeight: rs(32),
    fontWeight: "600",
    color: colors.text1,
  },
  /** Italic mango emphasis run inside a heading. */
  em: {
    fontFamily: "Fraunces_600SemiBold",
    fontStyle: "italic",
    color: colors.primary,
  },
  lede: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.text2,
  },
});
