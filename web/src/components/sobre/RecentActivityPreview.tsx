"use client";

import { useMemo } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";

import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";

interface SubaccountRef {
  address: string;
  name: string;
  avatarUrl?: string | null;
}

/**
 * Home-tab activity preview: 3 most-recent money-moving events rendered
 * using the SAME row primitive as the full Activity tab. That way Home
 * and Activity never drift visually — a Deposit row on the home preview
 * looks identical to one in the full feed. "See all" jumps to Activity.
 */
export function RecentActivityPreview({
  events,
  loading,
  members,
  subaccounts = [],
  envelopeNames,
  onSeeAll,
  onExpenseDeleted,
}: {
  events: FeedEvent[];
  /** True until the tx feed's first successful RPC page returns. */
  loading: boolean;
  members: Member[];
  subaccounts?: SubaccountRef[];
  envelopeNames: string[];
  onSeeAll: () => void;
  onExpenseDeleted?: () => void;
}) {
  // Memoized so the parent's 3s wallet-state poll doesn't hand a fresh
  // array to ActivityFeed each tick — that would invalidate every memo
  // downstream (groups, ordered, totalEntries, labelFor Map) for a static
  // 3-row preview whose input didn't actually change.
  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          e.kind === "Withdraw" ||
          e.kind === "Deposit" ||
          e.kind === "SubAccountFunded" ||
          e.kind === "SubAccountWithdraw" ||
          (e.kind === "ExpenseLog" && e.amount !== null),
      ),
    [events],
  );

  return (
    <section className="sobre-recent" aria-label="Recent activity">
      <div className="sobre-recent-head">
        <h3>Recent activity</h3>
        {filtered.length > 0 ? (
          <button
            type="button"
            className="sobre-recent-see-all"
            onClick={onSeeAll}
          >
            See all
            <CaretRightIcon weight="bold" size={12} />
          </button>
        ) : null}
      </div>
      <ActivityFeed
        events={filtered}
        loading={loading}
        error={null}
        newestTxHash={null}
        members={members}
        subaccounts={subaccounts}
        envelopeNames={envelopeNames}
        onExpenseDeleted={onExpenseDeleted}
        hideTitle
        hideDayLabels
        maxRows={3}
      />
    </section>
  );
}
