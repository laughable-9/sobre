/**
 * Pill call-to-action button with a trailing arrow, used across the landing
 * page. `primary` is the mango fill on light backgrounds; `cream` is the
 * light fill used on the dark palm-green final CTA section.
 */

import { Pressable, StyleSheet, Text } from "react-native";
import { ArrowRight } from "lucide-react-native";

import { colors, radius } from "../../theme/tokens";

export function CtaButton({
  label,
  onPress,
  variant = "primary",
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "cream";
  /** Stretch to fill the container (bottom-anchored CTA on the mobile landing)
   *  instead of hugging its label. */
  fullWidth?: boolean;
}) {
  const isCream = variant === "cream";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.cta,
        fullWidth ? styles.fullWidth : null,
        isCream ? styles.cream : styles.primary,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.label, isCream ? styles.labelCream : null]}>
        {label}
      </Text>
      <ArrowRight
        size={16}
        strokeWidth={2.4}
        color={isCream ? colors.text1 : colors.primaryText}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  primary: {
    backgroundColor: colors.primary,
  },
  cream: {
    backgroundColor: colors.bg,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primaryText,
  },
  labelCream: {
    color: colors.text1,
  },
});
