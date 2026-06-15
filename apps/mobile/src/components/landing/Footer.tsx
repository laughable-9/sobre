/**
 * Landing footer — brand, blurb, and copyright.
 * Mirrors the Footer of web/src/app/page.tsx (links omitted on mobile).
 */

import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/tokens";
import { Brand } from "../ui/Brand";

export function Footer() {
  return (
    <View style={styles.footer}>
      <Brand />
      <Text style={styles.blurb}>
        A joint account for families living worlds apart. Made for OFWs, built on
        Stellar.
      </Text>
      <Text style={styles.copy}>
        © 2026 Sobre. Built for Stellar Philippines Hackathon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    gap: 12,
  },
  blurb: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text2,
    maxWidth: 320,
  },
  copy: {
    fontSize: 12,
    color: colors.text3,
    marginTop: 8,
  },
});
