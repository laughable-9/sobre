/**
 * Read-only port of web/src/components/sobre/EnvelopeCard.tsx. The "Spend"
 * button is omitted (write action, no mobile signing yet). The web version
 * derives spentThisMonth/lastActivity from useTxFeed, which hasn't been
 * ported yet — both are optional props here and default to "no activity".
 */

import { StyleSheet, Text, View } from "react-native";
import {
  GraduationCap,
  Lock,
  ShoppingCart,
  Sprout,
  TrendingUp,
} from "lucide-react-native";

import {
  ENVELOPE_LABELS,
  STROOPS_PER_XLM,
  displayEnvelopeName,
  type EnvelopeName,
} from "../../lib/config";
import { formatPhpLocale } from "../../lib/format";
import { usePhpPerXlm } from "../../lib/usePhpPerXlm";
import { colors, radius, shadows } from "../../theme/tokens";
import { AnimatedNumber } from "../ui/AnimatedNumber";

const ICON_BY_NAME: Record<
  EnvelopeName,
  React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
> = {
  Groceries: ShoppingCart,
  Tuition: GraduationCap,
  Savings: Sprout,
};

export function EnvelopeCard({
  index,
  balanceStroops,
  percent,
  approvalRequired,
  envelopeNames,
  spentThisMonthStroops = 0n,
  lastActivity = null,
}: {
  index: number;
  balanceStroops: bigint;
  percent: number;
  /** True when require_all_sigs is on OR this envelope is in protected_envelopes. */
  approvalRequired: boolean;
  envelopeNames: string[];
  /** From the activity feed; defaults to 0 until useTxFeed is ported. */
  spentThisMonthStroops?: bigint;
  /** From the activity feed; defaults to null ("No activity yet"). */
  lastActivity?: string | null;
}) {
  const phpPerXlm = usePhpPerXlm();
  const slot = ENVELOPE_LABELS[index];
  const name = displayEnvelopeName(slot, envelopeNames);
  const xlm = Number(balanceStroops) / STROOPS_PER_XLM;
  const php = xlm * phpPerXlm;
  const isSavings = slot === "Savings";
  const isEmpty = balanceStroops === 0n;
  const Icon = ICON_BY_NAME[slot];

  return (
    <View
      style={[
        styles.card,
        shadows.sm,
        isSavings ? styles.green : null,
        isEmpty ? styles.empty : null,
      ]}
    >
      <View style={styles.row1}>
        <View style={styles.icon}>
          <Icon size={20} color={isSavings ? colors.accent : colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>{name}</Text>
        <View style={styles.metaRight}>
          {approvalRequired ? (
            <View style={[styles.pill, styles.pillWarning]}>
              <Lock size={11} color="#B88B1C" strokeWidth={2.5} />
              <Text style={styles.pillWarningText}>Approval required</Text>
            </View>
          ) : null}
          {isSavings ? (
            <View style={[styles.pill, styles.pillGreen]}>
              <TrendingUp size={12} color={colors.accent} strokeWidth={2} />
              <Text style={styles.pillGreenText}>4.5% APY</Text>
            </View>
          ) : null}
          <View style={[styles.pill, styles.pillCream]}>
            <Text style={styles.pillCreamText}>{percent}% split</Text>
          </View>
        </View>
      </View>

      <AnimatedNumber
        value={php}
        format={(n) =>
          `₱ ${n.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        }
        style={styles.amount}
      />

      <Text style={styles.xlm}>{xlm.toFixed(4)} XLM</Text>

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Spent this month</Text>
          <Text style={styles.metaValue}>
            {formatPhpLocale(spentThisMonthStroops)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLast}>
            {lastActivity ?? "No activity yet"}
          </Text>
        </View>
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
    padding: 16,
  },
  green: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  empty: {
    opacity: 0.7,
  },
  row1: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.text1,
  },
  metaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pillWarning: {
    backgroundColor: "#FDF3D8",
  },
  pillWarningText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#B88B1C",
  },
  pillGreen: {
    backgroundColor: colors.accentSoft,
  },
  pillGreenText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.accent,
  },
  pillCream: {
    backgroundColor: colors.surfaceAlt,
  },
  pillCreamText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.text2,
  },
  amount: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 28,
    fontWeight: "600",
    color: colors.text1,
    marginTop: 14,
  },
  xlm: {
    fontSize: 13,
    color: colors.text2,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  meta: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaLabel: {
    fontSize: 12,
    color: colors.text2,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text1,
    fontVariant: ["tabular-nums"],
  },
  metaLast: {
    fontSize: 12,
    color: colors.text3,
  },
});
