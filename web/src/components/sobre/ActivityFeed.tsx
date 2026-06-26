"use client";

import { useMemo } from "react";
import {
  ArrowDownToLine,
  CheckCheck,
  Clock,
  Hourglass,
  ShoppingBag,
  UserMinus,
  UserPlus,
  X as XIcon,
} from "lucide-react";

import type { ActiveDepositRow } from "@/hooks/useActiveDeposits";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import { displayEnvelopeName } from "@/lib/config";
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
  envelopeNames: string[];
  /** Non-terminal deposit rows surfaced as "pending" affordances at the top
   *  of the feed. The Resume button reopens the deposit modal at whatever
   *  step matches the row's status. */
  pendingDeposits?: ActiveDepositRow[];
  /** Called when the user taps Resume on a pending deposit. The dashboard
   *  opens the modal with `resumeIdentifier=identifier`. */
  onResumeDeposit?: (identifier: string) => void;
}

export function ActivityFeed({
  events,
  loading,
  error,
  newestTxHash,
  members,
  envelopeNames,
  pendingDeposits,
  onResumeDeposit,
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

        {/* Pending deposits live above the on-chain bucket so a user who
            closed the modal mid-flow can see them the moment the dashboard
            re-mounts. Each row's Resume button rehydrates the modal at the
            phase matching the row's status (typically the ConfirmStep). */}
        {pendingDeposits && pendingDeposits.length > 0 ? (
          <div>
            <div className="sobre-day">PENDING</div>
            {pendingDeposits.map((d) => (
              <PendingDepositRow
                key={d.identifier}
                deposit={d}
                onResume={onResumeDeposit}
              />
            ))}
          </div>
        ) : null}

        {!error && events.length === 0 && !pendingDeposits?.length ? (
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
                envelopeNames={envelopeNames}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Row rendered above the on-chain bucket for a non-terminal `pdax_deposits`
 *  row. The status label changes per state, but the action — Resume —
 *  is always the same: re-open the modal at the matching phase. */
function PendingDepositRow({
  deposit,
  onResume,
}: {
  deposit: ActiveDepositRow;
  onResume?: (identifier: string) => void;
}) {
  const time = fmtTime(deposit.created_at);
  const statusLabel: Record<ActiveDepositRow["status"], string> = {
    pending: "Awaiting payment",
    funded: "Buying XLM",
    credited: "Ready to split",
    split: "Split",
    failed: "Failed",
  };
  return (
    <button
      type="button"
      onClick={() => onResume?.(deposit.identifier)}
      className="sobre-activity-item pending"
      style={{
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        background: "var(--accent-soft)",
        border: "none",
      }}
    >
      <div className="ic">
        <Clock size={16} strokeWidth={2} />
      </div>
      <div className="body">
        <div className="who">
          Pending deposit{" "}
          <span className="amt tabular">
            ₱{Number(deposit.amount_php).toLocaleString("en-PH")}
          </span>
        </div>
        <div className="where">
          {statusLabel[deposit.status]} · tap to resume
        </div>
        <div className="meta">{time}</div>
      </div>
    </button>
  );
}

function ActivityRow({
  ev,
  isNew,
  labelFor,
  envelopeNames,
}: {
  ev: FeedEvent;
  isNew: boolean;
  labelFor: (addr: string) => string;
  envelopeNames: string[];
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
              from {displayEnvelopeName(ev.envelope, envelopeNames)}
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
              from {displayEnvelopeName(ev.envelope, envelopeNames)}
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
    case "MemberJoined":
      return wrap(
        "inflow",
        <>
          <div className="ic">
            <UserPlus size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              {ev.emoji ? `${ev.emoji} ` : ""}
              <b>{ev.name || labelFor(ev.member)}</b> joined the wallet
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    case "MemberRemoved":
      return wrap(
        "outflow",
        <>
          <div className="ic">
            <UserMinus size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              <b>{labelFor(ev.member)}</b> was removed from the wallet
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
  }
}
