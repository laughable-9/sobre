/**
 * Read-only dashboard screen. Mirrors the shape of
 * web/src/app/dashboard/[contractId]/page.tsx's envelopes tab, minus every
 * write action (deposit, spend, invite, settings) — those need a mobile
 * signing solution first (see docs/tech-stack-architecture.md, Option A).
 *
 * Renders an empty state until a wallet is connected: there is currently no
 * mobile equivalent of useFreighter, so `address`/`contractId` have nowhere
 * to come from yet. Once a wallet-connect flow lands, pass real values here.
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Wallet } from "lucide-react-native";

import { EnvelopeCard, SummaryCard } from "../components/dashboard";
import { useWalletState } from "../hooks/useWalletState";
import { ENVELOPE_LABELS } from "../lib/config";
import { colors } from "../theme/tokens";

export function Dashboard({
  address,
  contractId,
}: {
  address: string | null;
  contractId: string | null;
}) {
  const { state, loading, error } = useWalletState(address, contractId);

  if (!address || !contractId) {
    return (
      <View style={styles.center}>
        <Wallet size={40} color={colors.text3} strokeWidth={1.5} />
        <Text style={styles.emptyTitle}>No wallet connected</Text>
        <Text style={styles.emptyBody}>
          Connect a Stellar wallet to see your envelopes and balances.
        </Text>
      </View>
    );
  }

  if (loading || !state) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyBody}>
          {error ? `Couldn't load wallet: ${error}` : "Loading..."}
        </Text>
      </View>
    );
  }

  const dailySpent = 0n; // TODO: derive from useTxFeed once ported.

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>{state.wallet_name || "Family Wallet"}</Text>

      <SummaryCard state={state} address={address} dailySpent={dailySpent} />

      <View style={styles.envelopes}>
        {state.balances.map((balance, i) => (
          <EnvelopeCard
            key={i}
            index={i}
            balanceStroops={balance}
            percent={state.percents[i] ?? 0}
            approvalRequired={
              state.policy.require_all_sigs ||
              state.policy.protected_envelopes.includes(ENVELOPE_LABELS[i])
            }
            envelopeNames={state.envelope_names}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  heading: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 24,
    fontWeight: "600",
    color: colors.text1,
  },
  envelopes: {
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text1,
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 13,
    color: colors.text2,
    textAlign: "center",
  },
});
