/**
 * Small uppercase label that sits above section headings — the "eyebrow"
 * pattern from the web landing page. Defaults to the mango accent; pass
 * `green` for the palm-green variant used in the family-side column.
 */

import { StyleSheet, Text } from "react-native";

import { colors } from "../../theme/tokens";

export function Eyebrow({
  children,
  green,
}: {
  children: string;
  green?: boolean;
}) {
  return (
    <Text style={[styles.eyebrow, green ? styles.green : null]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.primaryHover,
  },
  green: {
    color: colors.accent,
  },
});
