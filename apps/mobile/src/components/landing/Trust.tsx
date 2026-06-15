/**
 * "Why this works" section — the three trust cards (Stellar, on-chain, fees).
 * Mirrors the Trust section of web/src/app/page.tsx.
 */

import { StyleSheet, Text, View } from "react-native";

import { TRUST } from "../../content/landing";
import { colors, radius, shadows } from "../../theme/tokens";
import { Eyebrow } from "../ui/Eyebrow";
import { sectionStyles as ss } from "./sectionStyles";

export function Trust() {
  return (
    <View style={ss.section}>
      <Eyebrow>Why this works</Eyebrow>
      <Text style={ss.h2}>Built on infrastructure you can audit.</Text>
      <Text style={ss.lede}>
        Sobre is built on Stellar — the same chain used by MoneyGram for
        cross-border payouts. The contract is token-agnostic, so the same wallet
        works for XLM today and stablecoins on the roadmap. Every transaction is
        public and verifiable.
      </Text>

      <View style={styles.grid}>
        {TRUST.map((t) => (
          <View key={t.title} style={[styles.card, shadows.sm]}>
            <View style={styles.icon}>
              <t.Icon size={18} strokeWidth={2} color={colors.accent} />
            </View>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.body}>{t.body}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 12,
    marginTop: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.btn,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text1,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text2,
  },
});
