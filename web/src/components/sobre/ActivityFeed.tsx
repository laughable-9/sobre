"use client";

import { useMemo } from "react";
import { ArrowDownToLine, ShoppingBag, Hourglass, CheckCheck, X as XIcon } from "lucide-react";

import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import { formatPhpLocale, shortenAddress } from "@/lib/format";

function bucket(closedAtIso: string): "TODAY" | "YESTERDAY" | "EARLIER" {
  const now = new Date();
  const ev = new Date(closedAtIso);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(ev, now)) return "TODAY";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(ev, yesterday)) return "YESTERDAY";
  return "EARLIER";
}

function fmtTime(closedAtIso: string): string {
  return new Date(closedAtIso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ActivityFeedProps {
  events: FeedEvent[];
  loading: boolean;
  error: string | null;
  newestTxHash: string | null;
  /** Look-up so "GA12...spent" renders as "Maria spent". Pass state.members. */
  members: Member[];
}

export function ActivityFeed({
  events,
  loading,
  error,
  newestTxHash,
  members,
}: ActivityFeedProps) {
  const nameByAddress = useMemo(() => {
    const out = new Map<string, { name: string; emoji: string }>();
    for (const m of members) {
      out.set(m.address, { name: m.name, emoji: m.emoji });
    }
    return out;
  }, [members]);

  const labelFor = (addr: string): string => {
    const profile = nameByAddress.get(addr);
    if (!profile) return shortenAddress(addr);
    return profile.emoji
      ? `${profile.emoji} ${profile.name}`
      : profile.name;
  };
  const groups = useMemo(() => {
    const out: Record<"TODAY" | "YESTERDAY" | "EARLIER", FeedEvent[]> = {
      TODAY: [],
      YESTERDAY: [],
      EARLIER: [],
    };
    for (const ev of events) {
      out[bucket(ev.ledgerClosedAt)].push(ev);
    }
    return out;
  }, [events]);

  const ordered = (["TODAY", "YESTERDAY", "EARLIER"] as const).filter(
    (day) => groups[day].length > 0,
  );

  return (
    <aside className="sobre-activity">
      <div className="head">
        <h3>Activity</h3>
      </div>
      <div className="list">
        {error ? (
          <p
            className="text-xs break-all"
            style={{ color: "var(--sobre-danger)" }}
          >
            Feed error: {error}
          </p>
        ) : null}

        {!error && events.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            {loading ? "Loading events…" : "No on-chain events yet."}
          </p>
        ) : null}

        {ordered.map((day) => (
          <div key={day}>
            <div className="sobre-day">{day}</div>
            {groups[day].map((ev) => (
              <ActivityRow
                key={`${ev.txHash}-${ev.ledger}-${ev.kind}`}
                ev={ev}
                isNew={ev.txHash === newestTxHash}
                labelFor={labelFor}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function ActivityRow({
  ev,
  isNew,
  labelFor,
}: {
  ev: FeedEvent;
  isNew: boolean;
  labelFor: (addr: string) => string;
}) {
  const time = fmtTime(ev.ledgerClosedAt);
  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${ev.txHash}`;

  // Each row wraps its content in an anchor so clicking opens the underlying
  // Stellar transaction on stellar.expert in a new tab. The trailing arrow is
  // a small affordance so this isn't a mystery hover.
  const wrap = (kindClass: string, content: React.ReactNode) => (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noreferrer"
      className={`sobre-activity-item ${kindClass} ${isNew ? "new" : ""}`}
      title="View transaction on stellar.expert"
    >
      {content}
    </a>
  );

  switch (ev.kind) {
    case "Deposit":
      return wrap(
        "inflow",
        <>
          <div className="ic">
            <ArrowDownToLine size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              Remittance received{" "}
              <span className="amt tabular">
                + {formatPhpLocale(ev.amount)}
              </span>
            </div>
            <div className="where">
              Auto-split · G {formatPhpLocale(ev.groceries)} · T{" "}
              {formatPhpLocale(ev.tuition)} · S{" "}
              {formatPhpLocale(ev.savings)}
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    case "Spend":
      return wrap(
        "outflow",
        <>
          <div className="ic">
            <ShoppingBag size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              {labelFor(ev.caller)} spent{" "}
              <span className="amt tabular">{formatPhpLocale(ev.amount)}</span>{" "}
              from {ev.envelope}
            </div>
            {ev.memo ? <div className="where">&quot;{ev.memo}&quot;</div> : null}
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    case "RequestCreated":
      return wrap(
        "pending",
        <>
          <div className="ic">
            <Hourglass size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              {labelFor(ev.caller)} requested{" "}
              <span className="amt tabular">{formatPhpLocale(ev.amount)}</span>{" "}
              from {ev.envelope}
            </div>
            {ev.memo ? <div className="where">&quot;{ev.memo}&quot;</div> : null}
            <div className="meta">
              awaiting approval · {time} · #{ev.requestId.toString()} · view tx ↗
            </div>
          </div>
        </>,
      );
    case "RequestApproved":
      return wrap(
        "inflow",
        <>
          <div className="ic">
            <CheckCheck size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              Request #{ev.requestId.toString()} approved
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    case "RequestDenied":
      return wrap(
        "outflow",
        <>
          <div className="ic">
            <XIcon size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              Request #{ev.requestId.toString()} denied
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
  }
}
