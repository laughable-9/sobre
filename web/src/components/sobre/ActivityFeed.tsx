"use client";

import { useMemo } from "react";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCheck,
  Clock,
  Hourglass,
  Loader2,
  Lock,
  LockOpen,
  Send,
  ShoppingBag,
  Trash2,
  UserMinus,
  UserPlus,
  X as XIcon,
} from "lucide-react";

import type { ActiveCashoutRow } from "@/hooks/useActiveCashouts";
import type { ActiveDepositRow } from "@/hooks/useActiveDeposits";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import { bankName } from "@/lib/banks";
import { displayEnvelopeName, STROOPS_PER_TOKEN } from "@/lib/config";
import {
  formatPhpLocale,
  maskAccountNumber,
  shortenAddress,
} from "@/lib/format";


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
  /** Same shape as members but for sub-account holders, so SubAccount* events
   *  render with the kid's display name + emoji instead of a raw C-address. */
  subaccounts?: { address: string; name: string; emoji: string }[];
  envelopeNames: string[];
  /** Non-terminal deposit rows surfaced as "pending" affordances at the top
   *  of the feed. The Resume button reopens the deposit modal at whatever
   *  step matches the row's status. */
  pendingDeposits?: ActiveDepositRow[];
  /** Called when the user taps Resume on a pending deposit. The dashboard
   *  opens the modal with `resumeIdentifier=identifier`. */
  onResumeDeposit?: (identifier: string) => void;
  /** Called when the user taps the cancel icon on a pending deposit. The
   *  dashboard hits /api/pdax/deposits/[id]/cancel and refreshes the
   *  active list. Returns `{ ok: boolean, alreadyPaid?: true }` so the
   *  row knows whether to play its exit animation or stay put with a
   *  notice. */
  onCancelDeposit?: (
    identifier: string,
  ) => Promise<{ ok: boolean; alreadyPaid?: boolean }>;
  /** In-flight cashouts surfaced alongside pending deposits. Money has
   *  already moved by the time these appear; the row exists so the user
   *  knows where it is. Tap re-opens the modal at the awaiting view. */
  pendingCashouts?: ActiveCashoutRow[];
  onResumeCashout?: (identifier: string) => void;
  /** Terminal failed rows (~last 7 days) — rendered as warning entries
   *  in the appropriate day bucket so the user has an honest trail of
   *  cashouts/deposits that didn't go through. */
  failedDeposits?: ActiveDepositRow[];
  failedCashouts?: ActiveCashoutRow[];
  /** Successful (paid) cashouts. Activity feed correlates these against
   *  on-chain Spend events to show the destination bank inline. */
  completedCashouts?: ActiveCashoutRow[];
}

export function ActivityFeed({
  events,
  loading,
  error,
  newestTxHash,
  members,
  subaccounts,
  envelopeNames,
  pendingDeposits,
  onResumeDeposit,
  onCancelDeposit,
  pendingCashouts,
  onResumeCashout,
  failedDeposits,
  failedCashouts,
  completedCashouts,
}: ActivityFeedProps) {
  const nameByAddress = useMemo(() => {
    const out = new Map<string, { name: string; emoji: string }>();
    for (const m of members) {
      out.set(m.address, { name: m.name, emoji: m.emoji });
    }
    for (const s of subaccounts ?? []) {
      out.set(s.address, { name: s.name, emoji: s.emoji });
    }
    return out;
  }, [members, subaccounts]);

  const labelFor = (addr: string): string => {
    const profile = nameByAddress.get(addr);
    if (!profile) return shortenAddress(addr);
    return profile.emoji
      ? `${profile.emoji} ${profile.name}`
      : profile.name;
  };

  // Index completed cashouts by envelope+amount+rough-minute so the
  // on-chain Spend event renderer can look up the destination bank
  // without a server round-trip. Same envelope + amount + ~1min window
  // is enough disambiguation in practice — collisions would require
  // the user to fire two identical cashouts in the same minute.
  const cashoutByEventKey = useMemo(() => {
    const out = new Map<string, ActiveCashoutRow>();
    for (const c of completedCashouts ?? []) {
      const stroops = BigInt(Math.round(c.amount_usdc * STROOPS_PER_TOKEN));
      const minuteKey = Math.floor(
        new Date(c.created_at).getTime() / 60_000,
      );
      // Try a couple of nearby minutes too — the on-chain ledger close
      // timestamp can lag/lead the row created_at by ~5-15s.
      for (const offset of [-1, 0, 1]) {
        out.set(
          `${c.envelope}:${stroops}:${minuteKey + offset}`,
          c,
        );
      }
    }
    return out;
  }, [completedCashouts]);

  const matchCompleted = (
    ev: FeedEvent & { kind: "Spend" },
  ): ActiveCashoutRow | undefined => {
    const minuteKey = Math.floor(
      new Date(ev.ledgerClosedAt).getTime() / 60_000,
    );
    return cashoutByEventKey.get(`${ev.envelope}:${ev.amount}:${minuteKey}`);
  };
  // FeedEntry is the union of on-chain events and PDAX-side failure
  // rows. We render them as a single time-sorted stream per day so the
  // user sees "Cashout failed at 11:38 PM" right next to the
  // corresponding on-chain "withdrew for cashout" event.
  type FeedEntry =
    | { kind: "event"; when: string; data: FeedEvent }
    | {
        kind: "failed_deposit";
        when: string;
        data: ActiveDepositRow;
      }
    | {
        kind: "failed_cashout";
        when: string;
        data: ActiveCashoutRow;
      };
  const groups = useMemo(() => {
    const out: Record<"TODAY" | "YESTERDAY" | "EARLIER", FeedEntry[]> = {
      TODAY: [],
      YESTERDAY: [],
      EARLIER: [],
    };
    for (const ev of events) {
      out[bucket(ev.ledgerClosedAt)].push({
        kind: "event",
        when: ev.ledgerClosedAt,
        data: ev,
      });
    }
    for (const d of failedDeposits ?? []) {
      out[bucket(d.created_at)].push({
        kind: "failed_deposit",
        when: d.created_at,
        data: d,
      });
    }
    for (const c of failedCashouts ?? []) {
      out[bucket(c.created_at)].push({
        kind: "failed_cashout",
        when: c.created_at,
        data: c,
      });
    }
    for (const day of ["TODAY", "YESTERDAY", "EARLIER"] as const) {
      out[day].sort(
        (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
      );
    }
    return out;
  }, [events, failedDeposits, failedCashouts]);

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
        {(pendingDeposits && pendingDeposits.length > 0) ||
        (pendingCashouts && pendingCashouts.length > 0) ? (
          <div>
            <div className="sobre-day">PENDING</div>
            {pendingDeposits?.map((d) => (
              <PendingDepositRow
                key={d.identifier}
                deposit={d}
                onResume={onResumeDeposit}
                onCancel={onCancelDeposit}
              />
            ))}
            {pendingCashouts?.map((c) => (
              <PendingCashoutRow
                key={c.identifier}
                cashout={c}
                onResume={onResumeCashout}
              />
            ))}
          </div>
        ) : null}

        {!error &&
        events.length === 0 &&
        !pendingDeposits?.length &&
        !pendingCashouts?.length ? (
          <div className="sobre-activity-empty">
            <div className="ic">
              <Clock size={22} strokeWidth={1.75} />
            </div>
            <div className="msg">
              {loading ? "Loading activity…" : "Activity will show up here."}
            </div>
          </div>
        ) : null}

        {ordered.map((day) => (
          <div key={day}>
            <div className="sobre-day">{day}</div>
            {groups[day].map((entry) => {
              if (entry.kind === "event") {
                const ev = entry.data;
                const completed =
                  ev.kind === "Spend" && ev.memo === "PDAX cashout"
                    ? matchCompleted(ev)
                    : undefined;
                return (
                  <ActivityRow
                    key={`${ev.txHash}-${ev.ledger}-${ev.kind}`}
                    ev={ev}
                    isNew={ev.txHash === newestTxHash}
                    labelFor={labelFor}
                    envelopeNames={envelopeNames}
                    completedCashout={completed}
                  />
                );
              }
              if (entry.kind === "failed_deposit") {
                return (
                  <FailedDepositRow
                    key={`fd:${entry.data.identifier}`}
                    deposit={entry.data}
                  />
                );
              }
              return (
                <FailedCashoutRow
                  key={`fc:${entry.data.identifier}`}
                  cashout={entry.data}
                />
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Terminal failed deposit row. Renders the failure reason inline so the
 *  user gets a clear audit trail instead of the row silently disappearing
 *  the moment status flipped to `failed`. */
function FailedDepositRow({ deposit }: { deposit: ActiveDepositRow }) {
  const time = fmtTime(deposit.created_at);
  return (
    <div
      className="sobre-activity-item outflow"
      style={{ background: "var(--surface-alt)" }}
    >
      <div className="ic" style={{ color: "var(--sobre-danger)" }}>
        <AlertTriangle size={16} strokeWidth={2} />
      </div>
      <div className="body">
        <div className="who">
          Deposit didn&apos;t complete{" "}
          <span className="amt tabular" style={{ color: "var(--text-2)" }}>
            ₱{Number(deposit.amount_php).toLocaleString("en-PH")}
          </span>
        </div>
        {deposit.failure_reason ? (
          <div className="where">{deposit.failure_reason}</div>
        ) : null}
        <div className="meta">{time}</div>
      </div>
    </div>
  );
}

/** Terminal failed cashout row. The PDAX failure reason (from the
 *  webhook or poll-status) lands in failure_reason — surface it inline
 *  so the demo viewer sees what actually broke. */
function FailedCashoutRow({ cashout }: { cashout: ActiveCashoutRow }) {
  const time = fmtTime(cashout.created_at);
  return (
    <div
      className="sobre-activity-item outflow"
      style={{ background: "var(--surface-alt)" }}
    >
      <div className="ic" style={{ color: "var(--sobre-danger)" }}>
        <AlertTriangle size={16} strokeWidth={2} />
      </div>
      <div className="body">
        <div className="who">
          Cashout didn&apos;t complete{" "}
          <span className="amt tabular" style={{ color: "var(--text-2)" }}>
            ₱{Number(cashout.amount_php ?? 0).toLocaleString("en-PH")}
          </span>
        </div>
        {cashout.failure_reason ? (
          <div className="where">{cashout.failure_reason}</div>
        ) : null}
        <div className="meta">{time}</div>
      </div>
    </div>
  );
}

/** Row rendered above the on-chain bucket for a non-terminal `pdax_deposits`
 *  row. The primary tap resumes the modal at whatever phase matches the
 *  row's status. A small trash icon on the right cancels the row (marks
 *  it `failed` server-side). Cancel at status='credited' doesn't pull
 *  XLM back out of the smart wallet — that's a caveat we accept for the
 *  demo. */
const ROW_EXIT_MS = 300;

function PendingDepositRow({
  deposit,
  onResume,
  onCancel,
}: {
  deposit: ActiveDepositRow;
  onResume?: (identifier: string) => void;
  onCancel?: (
    identifier: string,
  ) => Promise<{ ok: boolean; alreadyPaid?: boolean }>;
}) {
  const [cancelling, setCancelling] = useState(false);
  // Two-step exit so the row stays gone even between "animation done" and
  // "API + parent refresh complete":
  // - exiting: applies the animate-out classes
  // - hidden: returns null after ROW_EXIT_MS so the row doesn't pop back
  //   into view when the css animation ends (tw-animate-css doesn't pin
  //   the final state) and isn't seen twice if the parent refreshes
  //   later than the animation finishes.
  const [exiting, setExiting] = useState(false);
  const [hidden, setHidden] = useState(false);
  const time = fmtTime(deposit.created_at);
  const statusLabel: Record<ActiveDepositRow["status"], string> = {
    pending: "Awaiting payment",
    funded: "Buying XLM",
    credited: "Ready to split",
    split: "Split",
    failed: "Failed",
  };
  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onCancel || cancelling) return;
    setCancelling(true);
    setExiting(true);
    const hideTimer = setTimeout(() => setHidden(true), ROW_EXIT_MS);
    try {
      const result = await onCancel(deposit.identifier);
      if (!result.ok && result.alreadyPaid) {
        // PDAX already received the payment. Don't hide the row —
        // poll-status will drive it through funded → credited and
        // PendingCashout/Deposit will transition normally.
        clearTimeout(hideTimer);
        setHidden(false);
        setExiting(false);
      }
    } catch {
      clearTimeout(hideTimer);
      setHidden(false);
      setExiting(false);
    } finally {
      setCancelling(false);
    }
  };
  if (hidden) return null;
  return (
    <div
      role="button"
      tabIndex={exiting ? -1 : 0}
      onClick={exiting ? undefined : () => onResume?.(deposit.identifier)}
      onKeyDown={(e) => {
        if (exiting) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onResume?.(deposit.identifier);
        }
      }}
      className={`sobre-activity-item pending ${
        exiting
          ? "animate-out fade-out slide-out-to-right duration-300"
          : ""
      }`}
      style={{
        cursor: exiting ? "default" : "pointer",
        pointerEvents: cancelling ? "none" : undefined,
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
      {onCancel ? (
        <button
          type="button"
          onClick={(e) => void handleCancel(e)}
          disabled={cancelling}
          aria-label="Cancel this pending deposit"
          title="Cancel"
          className="grid place-items-center"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "transparent",
            border: "none",
            color: cancelling ? "var(--sobre-accent)" : "var(--text-3)",
            cursor: cancelling ? "not-allowed" : "pointer",
            flexShrink: 0,
            transition: "color 150ms ease",
          }}
        >
          {cancelling ? (
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
          ) : (
            <Trash2 size={14} strokeWidth={2} />
          )}
        </button>
      ) : null}
    </div>
  );
}

/** In-flight cashout row. Unlike deposits there's no cancel — by the
 *  time the row exists, money has moved and the server is settling
 *  toward `paid` regardless. Tap re-opens the modal so the user can
 *  watch the spinner advance. */
function PendingCashoutRow({
  cashout,
  onResume,
}: {
  cashout: ActiveCashoutRow;
  onResume?: (identifier: string) => void;
}) {
  const time = fmtTime(cashout.created_at);
  const statusLabel: Record<ActiveCashoutRow["status"], string> = {
    pending: "Preparing",
    spent: "Forwarding to PDAX",
    transferred: "Converting to pesos",
    converted: "Sending payout request",
    processing: "Settling at your bank",
    paid: "Done",
    failed: "Failed",
  };
  // Recoverable rows are pending in the DB but the spend tx already
  // landed on chain — they're waiting for the user to finish, not for
  // the server to advance. "Preparing" would be misleading.
  const label = cashout.recoverable
    ? "Needs your confirmation · tap to resume"
    : `${statusLabel[cashout.status]} · tap to view`;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onResume?.(cashout.identifier)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onResume?.(cashout.identifier);
        }
      }}
      className="sobre-activity-item pending"
      style={{ cursor: "pointer" }}
    >
      <div className="ic">
        <ArrowUpFromLine size={16} strokeWidth={2} />
      </div>
      <div className="body">
        <div className="who">
          Cashout{" "}
          <span className="amt tabular">
            ₱{Number(cashout.amount_php ?? 0).toLocaleString("en-PH")}
          </span>
        </div>
        <div className="where">{label}</div>
        <div className="meta">{time}</div>
      </div>
    </div>
  );
}

function ActivityRow({
  ev,
  isNew,
  labelFor,
  envelopeNames,
  completedCashout,
}: {
  ev: FeedEvent;
  isNew: boolean;
  labelFor: (addr: string) => string;
  envelopeNames: string[];
  /** When this Spend event matches a successfully-paid PDAX cashout
   *  row, the matching row is passed in so we can render the destination
   *  bank inline ("✓ Sent to Security Bank •••1461"). */
  completedCashout?: ActiveCashoutRow;
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
              Auto-split · {time} · view tx ↗
            </div>
            <div className="sobre-activity-split-chips" aria-hidden>
              <span className="chip c0">
                <span className="swatch" />
                <span className="amt tabular">
                  {formatPhpLocale(ev.groceries)}
                </span>
                <span className="lbl">
                  {displayEnvelopeName("Groceries", envelopeNames)}
                </span>
              </span>
              <span className="chip c1">
                <span className="swatch" />
                <span className="amt tabular">
                  {formatPhpLocale(ev.tuition)}
                </span>
                <span className="lbl">
                  {displayEnvelopeName("Tuition", envelopeNames)}
                </span>
              </span>
              <span className="chip c2">
                <span className="swatch" />
                <span className="amt tabular">
                  {formatPhpLocale(ev.savings)}
                </span>
                <span className="lbl">
                  {displayEnvelopeName("Savings", envelopeNames)}
                </span>
              </span>
            </div>
          </div>
        </>,
      );
    case "Spend": {
      // Cashout-spends and regular spends are both Spend events on chain;
      // we differentiate by the memo. For the cashout-flavored entry,
      // describe what truly happened — the envelope was debited — without
      // claiming the bank received the money. That's what the PENDING
      // bucket + the bank-arrival toast are for.
      const isCashout = ev.memo === "PDAX cashout";
      return wrap(
        "outflow",
        <>
          <div className="ic">
            {isCashout ? (
              <ArrowUpFromLine size={16} strokeWidth={2} />
            ) : (
              <ShoppingBag size={16} strokeWidth={2} />
            )}
          </div>
          <div className="body">
            <div className="who">
              {isCashout ? (
                <>
                  {labelFor(ev.caller)} withdrew{" "}
                  <span className="amt tabular">
                    {formatPhpLocale(ev.amount)}
                  </span>{" "}
                  from {displayEnvelopeName(ev.envelope, envelopeNames)} for
                  cashout
                </>
              ) : (
                <>
                  {labelFor(ev.caller)} spent{" "}
                  <span className="amt tabular">
                    {formatPhpLocale(ev.amount)}
                  </span>{" "}
                  from {displayEnvelopeName(ev.envelope, envelopeNames)}
                </>
              )}
            </div>
            {ev.memo && !isCashout ? (
              <div className="where">&quot;{ev.memo}&quot;</div>
            ) : null}
            {isCashout && completedCashout ? (
              <div
                className="where"
                style={{
                  color: "var(--sobre-accent)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <CheckCheck size={12} strokeWidth={2.5} />
                Sent to {bankName(completedCashout.beneficiary_bank_code)}{" "}
                {maskAccountNumber(
                  completedCashout.beneficiary_account_number,
                )}
              </div>
            ) : null}
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    }
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
    case "SubAccountFunded":
      return wrap(
        "outflow",
        <>
          <div className="ic">
            <Send size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              Sent{" "}
              <span className="amt tabular">
                {formatPhpLocale(ev.amount)}
              </span>{" "}
              to <b>{labelFor(ev.recipient)}</b> from{" "}
              {displayEnvelopeName(ev.envelope, envelopeNames)}
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    case "SubAccountSpent": {
      // Sub-account cashout flows reuse this event with memo "Cash out" — the
      // copy mirrors how Spend renders cashout-flavoured events.
      const isCashout = ev.memo === "Cash out" || ev.memo === "PDAX cashout";
      return wrap(
        "outflow",
        <>
          <div className="ic">
            <ArrowUpFromLine size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              <b>{labelFor(ev.caller)}</b> {isCashout ? "cashed out" : "spent"}{" "}
              <span className="amt tabular">
                {formatPhpLocale(ev.amount)}
              </span>
            </div>
            {ev.memo && !isCashout ? (
              <div className="where">&quot;{ev.memo}&quot;</div>
            ) : null}
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    }
    case "SubAccountJoined":
      return wrap(
        "inflow",
        <>
          <div className="ic">
            <UserPlus size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              <b>{labelFor(ev.subaccount)}</b> joined as a supplementary account
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
    case "SubAccountLockChanged":
      return wrap(
        ev.locked ? "outflow" : "inflow",
        <>
          <div className="ic">
            {ev.locked ? (
              <Lock size={16} strokeWidth={2} />
            ) : (
              <LockOpen size={16} strokeWidth={2} />
            )}
          </div>
          <div className="body">
            <div className="who">
              <b>{labelFor(ev.subaccount)}</b>{" "}
              {ev.locked ? "was locked" : "was unlocked"}
            </div>
            <div className="meta">{time} · view tx ↗</div>
          </div>
        </>,
      );
  }
}
