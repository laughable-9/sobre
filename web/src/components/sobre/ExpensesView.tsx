"use client";

import { useMemo, useState } from "react";

import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import { formatPhpLocale } from "@/lib/format";

type Range = "this_month" | "last_month" | "all_time";

/**
 * Expenses view rendered inside the Activity tab when the segmented
 * control is set to "Expenses". Deliberately shaped as: chip filter
 * + hero total + the SAME activity list the Feed tab renders (filtered
 * to receipts). Row styling is identical across the two views so the
 * page doesn't feel like it changed design languages mid-scroll.
 */
export function ExpensesView({
  events,
  envelopeNames,
  members,
  subaccounts = [],
  onExpenseDeleted,
}: {
  events: FeedEvent[];
  envelopeNames: string[];
  members: Member[];
  subaccounts?: { address: string; name: string; avatarUrl?: string | null }[];
  onExpenseDeleted?: () => void;
}) {
  const [range, setRange] = useState<Range>("this_month");
  const { start, end, label } = useMemo(() => rangeBounds(range), [range]);

  const expenseEvents = useMemo(
    () =>
      events.filter((e): e is Extract<FeedEvent, { kind: "ExpenseLog" }> => {
        if (e.kind !== "ExpenseLog" || e.amount === null) return false;
        const t = new Date(e.ledgerClosedAt).getTime();
        return t >= start && t < end;
      }),
    [events, start, end],
  );

  const totalSpent = useMemo(
    () => expenseEvents.reduce((acc, ev) => acc + (ev.amount ?? 0n), 0n),
    [expenseEvents],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 20,
          marginBottom: 18,
          fontSize: 12,
        }}
      >
        <RangeButton
          label="This month"
          active={range === "this_month"}
          onClick={() => setRange("this_month")}
        />
        <RangeButton
          label="Last month"
          active={range === "last_month"}
          onClick={() => setRange("last_month")}
        />
        <RangeButton
          label="All time"
          active={range === "all_time"}
          onClick={() => setRange("all_time")}
        />
      </div>

      <div
        style={{
          padding: "16px 18px",
          background: "var(--sobre-primary)",
          color: "#fff",
          borderRadius: 14,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            opacity: 0.8,
          }}
        >
          {label}
        </div>
        <div
          className="tabular"
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            marginTop: 4,
          }}
        >
          {formatPhpLocale(totalSpent)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
          {expenseEvents.length}{" "}
          {expenseEvents.length === 1 ? "receipt" : "receipts"}
        </div>
      </div>

      <ActivityFeed
        events={expenseEvents}
        loading={false}
        error={null}
        newestTxHash={null}
        members={members}
        subaccounts={subaccounts}
        envelopeNames={envelopeNames}
        onExpenseDeleted={onExpenseDeleted}
        hideTitle
      />
    </div>
  );
}

function RangeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "2px 0",
        border: 0,
        borderBottom: active ? "1.5px solid var(--sobre-primary)" : "1.5px solid transparent",
        background: "transparent",
        color: active ? "var(--text-1)" : "var(--text-3)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "color 160ms ease",
      }}
    >
      {label}
    </button>
  );
}

/** Range boundaries in ms epoch. Anchored to PH-local wall time so the
 *  "this month" boundary matches the user's calendar month, not UTC. */
function rangeBounds(range: Range): { start: number; end: number; label: string } {
  const now = new Date();
  if (range === "all_time") {
    return { start: 0, end: now.getTime() + 1, label: "All time" };
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  if (range === "this_month") {
    const start = new Date(y, m, 1).getTime();
    const end = new Date(y, m + 1, 1).getTime();
    const label = now.toLocaleString("en-PH", { month: "long", year: "numeric" });
    return { start, end, label };
  }
  const start = new Date(y, m - 1, 1).getTime();
  const end = new Date(y, m, 1).getTime();
  const prev = new Date(y, m - 1, 1);
  const label = prev.toLocaleString("en-PH", { month: "long", year: "numeric" });
  return { start, end, label };
}
