"use client";

import { useMemo } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  ListChecks,
  Target,
  Users,
} from "lucide-react";

import { useExpenseLog } from "@/hooks/useExpenseLog";
import type { FeedEvent } from "@/hooks/useTxFeed";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import { formatPhpLocale, relativeTime } from "@/lib/format";

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
  onSeeAllActivity,
  children,
}: {
  events: FeedEvent[];
  familyWalletId: string | null;
  /** Opens the full activity view. The card embeds only the 3 latest. */
  onSeeAllActivity?: () => void;
  /** Rendered inside the Recent-activity section, between the rows and the
   *  see-all button (currently the board's placeholder signal pills). */
  children?: React.ReactNode;
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

      <div className="sobre-hsummary-activity">
        <div className="sobre-hsummary-activity-head">Recent activity</div>
        {events.length === 0 ? (
          <div className="sobre-hsummary-activity-empty">No activity yet.</div>
        ) : (
          events.slice(0, 3).map((ev) => {
            const d = describeEvent(ev);
            return (
              <div
                key={`${ev.txHash}-${ev.kind}`}
                className="sobre-hsummary-activity-row"
              >
                <span className={`ic ${d.tone}`}>{d.icon}</span>
                <span className="what">{d.text}</span>
                <span className="when">{relativeTime(ev.ledgerClosedAt)}</span>
              </div>
            );
          })
        )}
        {children ? <div className="mt-3">{children}</div> : null}
        {onSeeAllActivity ? (
          <button
            type="button"
            className="sobre-hsummary-seeall"
            onClick={onSeeAllActivity}
          >
            See all activity
            <ChevronRight size={14} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Compact one-line description for the mini feed. The full ActivityFeed view
 *  keeps the rich rendering; this is just the 3-row teaser on the card. */
function describeEvent(ev: FeedEvent): {
  icon: React.ReactNode;
  text: string;
  tone: "in" | "out" | "meta";
} {
  switch (ev.kind) {
    case "Deposit":
      return {
        icon: <ArrowDownToLine size={13} strokeWidth={2.2} />,
        text: `Received ${formatPhpLocale(ev.amount)}`,
        tone: "in",
      };
    case "Spend":
      return {
        icon: <ArrowUpRight size={13} strokeWidth={2.2} />,
        text: `Spent ${formatPhpLocale(ev.amount)}`,
        tone: "out",
      };
    case "SubAccountFunded":
      return {
        icon: <ArrowUpRight size={13} strokeWidth={2.2} />,
        text: `Sent ${formatPhpLocale(ev.amount)} to supplementary`,
        tone: "out",
      };
    case "SubAccountSpent":
      return {
        icon: <ArrowUpRight size={13} strokeWidth={2.2} />,
        text: `Supplementary spent ${formatPhpLocale(ev.amount)}`,
        tone: "out",
      };
    case "RequestCreated":
      return {
        icon: <ArrowUpRight size={13} strokeWidth={2.2} />,
        text: `Approval requested · ${formatPhpLocale(ev.amount)}`,
        tone: "meta",
      };
    case "RequestApproved":
      return {
        icon: <Users size={13} strokeWidth={2.2} />,
        text: "Request approved",
        tone: "meta",
      };
    case "RequestDenied":
      return {
        icon: <Users size={13} strokeWidth={2.2} />,
        text: "Request denied",
        tone: "meta",
      };
    case "MemberJoined":
      return {
        icon: <Users size={13} strokeWidth={2.2} />,
        text: "A member joined",
        tone: "meta",
      };
    case "MemberRemoved":
      return {
        icon: <Users size={13} strokeWidth={2.2} />,
        text: "A member was removed",
        tone: "meta",
      };
    case "SubAccountJoined":
      return {
        icon: <Users size={13} strokeWidth={2.2} />,
        text: "Supplementary account joined",
        tone: "meta",
      };
    default:
      return {
        icon: <Users size={13} strokeWidth={2.2} />,
        text: ev.kind,
        tone: "meta",
      };
  }
}
