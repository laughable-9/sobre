import type { FeedEvent } from "@/hooks/useTxFeed";
import {
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  displayEnvelopeName,
} from "@/lib/config";

export interface SubaccountActivityEntry {
  txHash: string;
  label: string;
  whenIso: string;
  php: number;
  direction: "in" | "out";
}

/**
 * Fold the family's on-chain event feed into the in/out history rows a
 * sub-account holder cares about. Funded events (admin tops up) read as
 * "Topped up from <Envelope>" inflows; SubAccountSpent events with the
 * cashout memo read as the kid's cashouts; everything else is filtered.
 *
 * Both `SubAccountView` (kid's view) and `SubAccountsPanel`'s per-card
 * history drawer (admin view) consume this — keeping the projection in
 * one place stops the two consumers from drifting in copy or filter.
 */
export function subaccountActivity(
  events: FeedEvent[],
  walletAddress: string | null,
  envelopeNames: string[],
  opts: { limit?: number } = {},
): SubaccountActivityEntry[] {
  if (!walletAddress) return [];
  const limit = opts.limit;
  const rows: SubaccountActivityEntry[] = [];
  for (const ev of events) {
    if (ev.kind === "SubAccountFunded" && ev.recipient === walletAddress) {
      const php = (Number(ev.amount) / STROOPS_PER_USDC) * PHP_PER_USDC;
      rows.push({
        txHash: ev.txHash,
        label: `Topped up from ${displayEnvelopeName(ev.envelope, envelopeNames)}`,
        whenIso: ev.ledgerClosedAt,
        php,
        direction: "in",
      });
    } else if (
      ev.kind === "SubAccountWithdraw" &&
      ev.caller === walletAddress
    ) {
      const php = (Number(ev.amount) / STROOPS_PER_USDC) * PHP_PER_USDC;
      rows.push({
        txHash: ev.txHash,
        label: ev.memo || "Cash out",
        whenIso: ev.ledgerClosedAt,
        php,
        direction: "out",
      });
    }
    if (limit !== undefined && rows.length >= limit) break;
  }
  return rows;
}
