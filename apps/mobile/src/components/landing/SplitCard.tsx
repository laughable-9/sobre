/**
 * The signature ₱10,000 → three-envelope split card — Sobre's product in one
 * visual. Extracted from SplitVisual so the mobile landing can use the card on
 * its own as the hero visual, without the web section's heading/eyebrow/lede.
 * SplitTile is private since it's only used here.
 */

import { StyleSheet, Text, View } from "react-native";

import { colors, radius, shadows } from "../../theme/tokens";

export function SplitCard() {
  return (
    <View style={[styles.card, shadows.md]}>
      <View style={styles.incoming}>
        <Text style={styles.incomingLabel}>Incoming</Text>
        <Text style={styles.incomingAmount}>₱ 10,000</Text>
        <Text style={styles.incomingSub}>625 XLM · from Riyadh</Text>
      </View>

      <View style={styles.tiles}>
        <SplitTile label="Groceries · 50%" amount="₱ 5,000" fill={50} />
        <SplitTile label="Tuition · 30%" amount="₱ 3,000" fill={30} />
        <SplitTile label="Savings · 20%" amount="₱ 2,000" fill={20} green />
      </View>

      <View style={styles.settled}>
        <View style={styles.settledDot} />
        <Text style={styles.settledText}>
          Settled on Stellar in 4.7 seconds · fee ₱0.04
        </Text>
      </View>
    </View>
  );
}

function SplitTile({
  label,
  amount,
  fill,
  green,
}: {
  label: string;
  amount: string;
  fill: number;
  green?: boolean;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileAmount}>{amount}</Text>
      <View style={styles.tileTrack}>
        <View
          style={[
            styles.tileFill,
            {
              width: `${fill}%`,
              backgroundColor: green ? colors.accent : colors.primary,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  incoming: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.card,
    padding: 16,
  },
  incomingLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.primaryHover,
  },
  incomingAmount: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 28,
    fontWeight: "600",
    color: colors.primaryHover,
    marginTop: 4,
  },
  incomingSub: {
    fontSize: 12,
    color: colors.text2,
    marginTop: 2,
  },
  tiles: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 12,
  },
  tileLabel: {
    fontSize: 10,
    color: colors.text2,
  },
  tileAmount: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 16,
    fontWeight: "600",
    color: colors.text1,
    marginTop: 6,
  },
  tileTrack: {
    height: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    marginTop: 8,
    overflow: "hidden",
  },
  tileFill: {
    height: "100%",
    borderRadius: 999,
  },
  settled: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    borderStyle: "dashed",
  },
  settledDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  settledText: {
    fontSize: 12,
    color: colors.text2,
  },
});
