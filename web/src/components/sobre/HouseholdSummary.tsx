"use client";

import { useMemo } from "react";
import { ArrowDownToLine, ListChecks, Target } from "lucide-react";

import { useExpenseLog } from "@/hooks/useExpenseLog";
import type { FeedEvent } from "@/hooks/useTxFeed";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { useCurrency } from "@/lib/currency";

/**
 * Household summary — this month's money at a glance:
 *   • Total deposited (on-chain Deposit events, current UTC month)
 *   • Total logged (off-chain expense notes this month)
 *   • % of spending tracked = logged-note count ÷ on-chain-spend count
 *
 * On-chain figures reuse the activity feed already loaded by the dashboard;
 * the logged count comes from expense_logs. Amount respects the app-wide
 * currency toggle.
 */
export function HouseholdSummary({
  events,
  familyWalletId,
}: {
  events: FeedEvent[];
  familyWalletId: string | null;
}) {
  const { logs } = useExpenseLog(familyWalletId);
  const { currency } = useCurrency();

  const { depositedStroops, spendCount } = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
    const inThisMonth = (iso: string) => {
      const d = new Date(iso);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}` === monthKey;
    };

    let deposited = 0n;
    let spends = 0;
    for (const ev of events) {
      if (!inThisMonth(ev.ledgerClosedAt)) continue;
      if (ev.kind === "Deposit") deposited += ev.amount;
      else if (ev.kind === "Spend" || ev.kind === "SubAccountSpent") spends += 1;
    }
    return { depositedStroops: deposited, spendCount: spends };
  }, [events]);

  const loggedThisMonth = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
    return logs.filter((l) => {
      const d = new Date(l.created_at);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}` === monthKey;
    }).length;
  }, [logs]);

  const trackedPct =
    spendCount === 0
      ? null
      : Math.min(100, Math.round((loggedThisMonth / spendCount) * 100));

  // Deposited amount in the active display currency.
  const depositedUsd = Number(depositedStroops) / STROOPS_PER_USDC;
  const depositedAmount =
    currency === "USD" ? depositedUsd : depositedUsd * PHP_PER_USDC;
  const depositedLabel = `${currency === "USD" ? "$" : "₱"}${depositedAmount.toLocaleString(
    "en-PH",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )}`;

  return (
    <section className="sobre-hsummary" aria-label="This month summary">
      <div className="sobre-hsummary-head">This month</div>

      <div className="sobre-hsummary-grid">
        <div className="sobre-hsummary-stat">
          <span className="sobre-hsummary-ic">
            <ArrowDownToLine size={15} strokeWidth={2} />
          </span>
          <div className="sobre-hsummary-body">
            <div className="sobre-hsummary-label">Deposited</div>
            <div className="sobre-hsummary-value tabular">{depositedLabel}</div>
          </div>
        </div>

        <div className="sobre-hsummary-stat">
          <span className="sobre-hsummary-ic">
            <ListChecks size={15} strokeWidth={2} />
          </span>
          <div className="sobre-hsummary-body">
            <div className="sobre-hsummary-label">Logged</div>
            <div className="sobre-hsummary-value tabular">
              {loggedThisMonth}
              <span className="sobre-hsummary-unit">
                {" "}
                note{loggedThisMonth === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>

        <div className="sobre-hsummary-stat">
          <span className="sobre-hsummary-ic accent">
            <Target size={15} strokeWidth={2} />
          </span>
          <div className="sobre-hsummary-body">
            <div className="sobre-hsummary-label">Spending tracked</div>
            <div className="sobre-hsummary-value tabular accent">
              {trackedPct === null ? "—" : `${trackedPct}%`}
            </div>
            <div className="sobre-hsummary-track" aria-hidden>
              <div
                className="sobre-hsummary-track-fill"
                style={{ width: `${trackedPct ?? 0}%` }}
              />
            </div>
            <div className="sobre-hsummary-sub">
              {spendCount === 0
                ? "No spends yet"
                : `${loggedThisMonth} of ${spendCount} spends noted`}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
