import type { ExpenseLog } from "@/hooks/useExpenseLog";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS } from "@/lib/config";
import { toStroops } from "@/lib/format";

/**
 * Convert Supabase expense_logs rows into synthetic FeedEvents so they can
 * slot into the existing merge + render pipelines alongside on-chain events.
 * text-only notes keep amount=null / items=[] so the row renderers can
 * differentiate them from receipt-scan entries.
 */
export function expenseLogsToFeedEvents(
  logs: ExpenseLog[],
  members: Member[],
  familyWalletId: string,
): FeedEvent[] {
  const memberByWalletId = new Map(
    members.filter((m) => m.walletDbId).map((m) => [m.walletDbId as string, m]),
  );
  return logs.map<FeedEvent>((log) => {
    const member = memberByWalletId.get(log.wallet_id);
    const authorAddress = member?.address ?? log.wallet_id;
    const amount = toStroops(log.amount_stroops);
    const subtotal = toStroops(log.subtotal_stroops);
    const tax = toStroops(log.tax_stroops);
    const envelope =
      log.envelope_index !== null && log.envelope_index !== undefined
        ? ENVELOPE_LABELS[log.envelope_index]
        : null;
    const items = Array.isArray(log.items)
      ? log.items
          .map((it) => {
            const unit = toStroops(it.unit_price_stroops);
            if (unit === null) return null;
            return {
              description: it.description,
              qty: it.qty,
              unit_price: unit,
              category: it.category,
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null)
      : [];
    return {
      kind: "ExpenseLog",
      // Ledger fields aren't real for off-chain rows; the merger only reads
      // ledgerClosedAt for bucketing so ledger=0 is fine. Sort by created_at
      // (when the user logged it), not occurred_at (the printed receipt date),
      // so a 2012 receipt logged today lands at the top of the feed instead of
      // buried under fourteen years of on-chain events. The printed date still
      // shows in the ReceiptDetailSheet header via `occurredAt`.
      ledger: 0,
      ledgerClosedAt: log.created_at,
      txHash: `expense:${log.id}`,
      logId: log.id,
      familyWalletId,
      caller: authorAddress,
      note: log.note,
      amount,
      subtotal,
      tax,
      envelope,
      vendor: log.vendor,
      category: Array.isArray(log.category) ? log.category : null,
      signedReceiptUrls: Array.isArray(log.signed_receipt_urls)
        ? log.signed_receipt_urls
        : log.signed_receipt_url
          ? [log.signed_receipt_url]
          : [],
      signedReceiptUrl: log.signed_receipt_url ?? null,
      occurredAt: log.occurred_at,
      addedAt: log.created_at,
      items,
    };
  });
}

