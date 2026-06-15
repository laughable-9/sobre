/**
 * "Two sides, one wallet" section — the sender column (mango) and the
 * family column (green), each with their bullet points.
 * Mirrors the TwoSides section of web/src/app/page.tsx. PointRow is a private
 * helper since it's only used here.
 */

import { StyleSheet, Text, View } from "react-native";

import { FAMILY_POINTS, SENDER_POINTS } from "../../content/landing";
import { colors, radius } from "../../theme/tokens";
import { Eyebrow } from "../ui/Eyebrow";
import { sectionStyles as ss } from "./sectionStyles";

export function TwoSides() {
  return (
    <View style={[ss.section, ss.alt]}>
      <Eyebrow>Two sides, one wallet</Eyebrow>
      <Text style={ss.h2}>
        For the sender. For the family. <Text style={ss.em}>Same wallet.</Text>
      </Text>

      <View style={styles.duo}>
        <View style={[styles.col, styles.mango]}>
          <Eyebrow>For the sender</Eyebrow>
          <Text style={styles.heading}>Send home with zero guesswork.</Text>
          {SENDER_POINTS.map((p, i) => (
            <PointRow key={i} text={p} />
          ))}
        </View>

        <View style={[styles.col, styles.green]}>
          <Eyebrow green>For the family at home</Eyebrow>
          <Text style={styles.heading}>
            Each person has their own envelope.
          </Text>
          {FAMILY_POINTS.map((p, i) => (
            <PointRow key={i} text={p} green />
          ))}
        </View>
      </View>
    </View>
  );
}

function PointRow({ text, green }: { text: string; green?: boolean }) {
  return (
    <View style={styles.pointRow}>
      <View
        style={[
          styles.dot,
          { backgroundColor: green ? colors.accent : colors.primary },
        ]}
      />
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  duo: {
    gap: 12,
    marginTop: 12,
  },
  col: {
    borderRadius: radius.card,
    padding: 20,
    gap: 8,
  },
  mango: {
    backgroundColor: colors.primarySoft,
  },
  green: {
    backgroundColor: colors.accentSoft,
  },
  heading: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 18,
    fontWeight: "600",
    color: colors.text1,
    marginBottom: 4,
  },
  pointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 7,
  },
  pointText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text1,
  },
});
