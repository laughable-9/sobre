/**
 * Final call-to-action band on the dark palm-green background.
 * Mirrors the FinalCTA section of web/src/app/page.tsx.
 */

import { StyleSheet, Text, View } from "react-native";

import { rs } from "../../theme/responsive";
import { colors } from "../../theme/tokens";
import { CtaButton } from "../ui/CtaButton";

export function FinalCTA({ onOpenSobre }: { onOpenSobre: () => void }) {
  return (
    <View style={styles.band}>
      <Text style={styles.heading}>
        <Text style={styles.em}>Open the Sobre.</Text> Open the plan.
      </Text>
      <Text style={styles.lede}>
        Open a wallet in 60 seconds. Invite your family. Send your first
        remittance.
      </Text>
      <CtaButton
        label="Start with Sobre, free"
        onPress={onOpenSobre}
        variant="cream"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 48,
    gap: 14,
    alignItems: "flex-start",
  },
  heading: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: rs(26),
    lineHeight: rs(32),
    fontWeight: "600",
    color: colors.onAccent,
  },
  em: {
    fontFamily: "Fraunces_600SemiBold",
    fontStyle: "italic",
    color: colors.onAccent,
  },
  lede: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.onAccentMuted,
  },
});
