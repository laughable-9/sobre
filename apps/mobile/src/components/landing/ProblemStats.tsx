/**
 * "The reality" section — the OFW remittance stat grid.
 * Mirrors the Problem section of web/src/app/page.tsx.
 */

import { StyleSheet, Text, View } from "react-native";

import { STATS, STAT_SOURCES } from "../../content/landing";
import { rs } from "../../theme/responsive";
import { colors, radius, shadows } from "../../theme/tokens";
import { Eyebrow } from "../ui/Eyebrow";
import { sectionStyles as ss } from "./sectionStyles";

export function ProblemStats() {
  return (
    <View style={[ss.section, ss.alt]}>
      <Eyebrow>The reality</Eyebrow>
      <Text style={ss.h2}>
        Money sent home,{"\n"}
        <Text style={ss.em}>but it's never enough.</Text>
      </Text>
      <Text style={ss.lede}>
        Years of work abroad. Billions sent home. And yet, most families still
        come up short.
      </Text>

      <View style={styles.grid}>
        {STATS.map((s, i) => (
          <View key={i} style={[styles.card, shadows.sm]}>
            <Text style={styles.num}>
              {s.num}
              {s.sub ? <Text style={styles.sub}> {s.sub}</Text> : null}
            </Text>
            <Text style={styles.desc}>{s.desc}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sources}>{STAT_SOURCES}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  card: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  num: {
    fontFamily: "Fraunces_700Bold",
    fontSize: rs(32),
    fontWeight: "700",
    color: colors.text1,
  },
  sub: {
    fontFamily: "Fraunces_400Regular",
    fontSize: 15,
    color: colors.text2,
  },
  desc: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.text2,
    marginTop: 8,
  },
  sources: {
    fontSize: 11,
    color: colors.text3,
    marginTop: 12,
  },
});
