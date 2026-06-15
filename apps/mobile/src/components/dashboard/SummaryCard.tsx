/**
 * Read-only port of web/src/components/sobre/SummaryCard.tsx. Deposit/invite/
 * kick actions are omitted (write actions, no mobile signing yet — see
 * docs/tech-stack-architecture.md). Shows total balance, XLM, envelope count,
 * daily limit, and the member list.
 */

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Timer } from "lucide-react-native";

import type { WalletState } from "../../hooks/useWalletState";
import { STROOPS_PER_XLM } from "../../lib/config";
import { shortenAddress } from "../../lib/format";
import { usePhpPerXlm } from "../../lib/usePhpPerXlm";
import { rs } from "../../theme/responsive";
import { colors, radius, shadows } from "../../theme/tokens";
import { AnimatedNumber } from "../ui/AnimatedNumber";

const MEMBER_PALETTES = [
  { bg: "#FBE7D2", fg: colors.primaryHover },
  { bg: colors.accentSoft, fg: colors.accent },
] as const;

export function SummaryCard({
  state,
  address,
  dailySpent,
}: {
  state: WalletState;
  address: string;
  /** Sum of stroops the connected user has spent today (UTC). */
  dailySpent: bigint;
}) {
  const phpPerXlm = usePhpPerXlm();
  const totalStroops = state.balances.reduce((acc, b) => acc + b, 0n);
  const totalXlm = Number(totalStroops) / STROOPS_PER_XLM;
  const totalPhp = totalXlm * phpPerXlm;

  return (
    <View style={[styles.card, shadows.md]}>
      <Text style={styles.label}>Total balance</Text>
      <AnimatedNumber
        value={totalPhp}
        format={(n) =>
          `₱ ${n.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        }
        style={styles.total}
        numberOfLines={1}
        adjustsFontSizeToFit
      />
      <View style={styles.subRow}>
        <Text style={styles.subText}>{totalXlm.toFixed(4)} XLM</Text>
        <View style={styles.dot} />
        <Text style={styles.subText}>{state.balances.length} envelopes</Text>
      </View>

      <DailyLimitCard
        dailyLimit={state.policy.daily_limit}
        dailySpent={dailySpent}
      />

      <View style={styles.membersSection}>
        <Text style={styles.label}>Members ({state.members.length}/2)</Text>
        <View style={styles.memberList}>
          {state.members.map((m, i) => {
            const palette = MEMBER_PALETTES[i % MEMBER_PALETTES.length];
            const memberIsAdmin = m.address === state.admin;
            const isYou = m.address === address;
            return (
              <View key={m.address} style={styles.memberRow}>
                <View
                  style={[styles.avatar, { backgroundColor: palette.bg }]}
                >
                  <Text style={{ color: palette.fg, fontSize: m.emoji ? 18 : 12 }}>
                    {m.emoji || m.address.slice(1, 3).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {m.name || shortenAddress(m.address)}
                    {isYou ? <Text style={styles.youTag}>  you</Text> : null}
                  </Text>
                  <Text style={styles.memberRole}>
                    {memberIsAdmin ? "Admin" : "Family member"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/**
 * The contract resets each member's daily spend counter at UTC midnight.
 * Mirror that here: tick once a minute so "resets in" stays roughly
 * accurate without a per-second timer.
 */
function DailyLimitCard({
  dailyLimit,
  dailySpent,
}: {
  dailyLimit: bigint | null;
  dailySpent: bigint;
}) {
  const phpPerXlm = usePhpPerXlm();
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (dailyLimit === null) {
    return (
      <View style={styles.limitEmpty}>
        <Timer size={14} color={colors.text3} strokeWidth={2} />
        <Text style={styles.limitEmptyText}>No daily spend limit set</Text>
      </View>
    );
  }

  const limitXlm = Number(dailyLimit) / STROOPS_PER_XLM;
  const limitPhp = limitXlm * phpPerXlm;
  const remainingStroops =
    dailySpent >= dailyLimit ? 0n : dailyLimit - dailySpent;
  const remainingXlm = Number(remainingStroops) / STROOPS_PER_XLM;
  const remainingPhp = remainingXlm * phpPerXlm;

  const usedFrac =
    dailyLimit === 0n
      ? 0
      : Math.min(1, Number(dailySpent) / Number(dailyLimit));
  const usedPct = usedFrac * 100;

  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const diffMs = tomorrow.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);

  const limitLabel = limitPhp.toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const remainingLabel = remainingPhp.toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const barColor =
    usedFrac >= 1
      ? colors.danger
      : usedFrac >= 0.8
        ? colors.warning
        : colors.accent;

  return (
    <View style={styles.limitCard}>
      <View style={styles.limitHeader}>
        <Text style={styles.label}>Daily limit</Text>
        <View style={styles.limitResets}>
          <Timer size={11} color={colors.text3} strokeWidth={2} />
          <Text style={styles.limitResetsText}>
            Resets in {hours}h {minutes}m
          </Text>
        </View>
      </View>
      <View style={styles.limitAmounts}>
        <Text style={styles.limitRemaining}>₱{remainingLabel}</Text>
        <Text style={styles.limitOf}>left of ₱{limitLabel}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${usedPct}%`, backgroundColor: barColor },
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
    padding: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: colors.text3,
  },
  total: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: rs(36),
    fontWeight: "600",
    color: colors.text1,
    marginTop: 6,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  subText: {
    fontSize: 13,
    color: colors.text2,
    fontVariant: ["tabular-nums"],
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.text3,
  },
  membersSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  memberList: {
    marginTop: 12,
    gap: 6,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text1,
  },
  youTag: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.accent,
  },
  memberRole: {
    fontSize: 12,
    color: colors.text2,
    marginTop: 1,
  },
  limitEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  limitEmptyText: {
    fontSize: 13,
    color: colors.text2,
  },
  limitCard: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  limitHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  limitResets: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  limitResetsText: {
    fontSize: 11,
    color: colors.text3,
    fontVariant: ["tabular-nums"],
  },
  limitAmounts: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 6,
  },
  limitRemaining: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 20,
    fontWeight: "600",
    color: colors.text1,
    fontVariant: ["tabular-nums"],
  },
  limitOf: {
    fontSize: 11,
    color: colors.text3,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
});
