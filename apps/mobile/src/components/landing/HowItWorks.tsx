/**
 * "How it works" section — the four numbered steps.
 * Mirrors the HowItWorks section of web/src/app/page.tsx.
 */

import { StyleSheet, Text, View } from "react-native";

import { STEPS } from "../../content/landing";
import { colors, radius, shadows } from "../../theme/tokens";
import { Eyebrow } from "../ui/Eyebrow";
import { sectionStyles as ss } from "./sectionStyles";

export function HowItWorks() {
  return (
    <View style={ss.section}>
      <Eyebrow>How it works</Eyebrow>
      <Text style={ss.h2}>
        Sending home, <Text style={ss.em}>simplified.</Text>
      </Text>
      <Text style={ss.lede}>
        Four steps. No banks. No middlemen. Just your family on the same page.
      </Text>

      <View style={styles.steps}>
        {STEPS.map((s) => (
          <View key={s.num} style={[styles.card, shadows.sm]}>
            <View style={styles.num}>
              <Text style={styles.numText}>{s.num}</Text>
            </View>
            <Text style={styles.fil}>{s.fil}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  steps: {
    gap: 12,
    marginTop: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  num: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  numText: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 16,
    fontWeight: "600",
    color: colors.primaryHover,
  },
  fil: {
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
