"use client";

import { useMemo, useState } from "react";
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

import { ActivityDetailModal } from "@/components/sobre/ActivityDetailModal";
import { ActivityRowsSkeleton } from "@/components/sobre/Skeletons";
import { Avatar } from "@/components/sobre/Avatar";
import { Sheet } from "@/components/sobre/Sheet";
import type { ActiveCashoutRow } from "@/hooks/useActiveCashouts";
import type { ActiveDepositRow } from "@/hooks/useActiveDeposits";
import { eventActor, type FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import { STROOPS_PER_TOKEN, displayEnvelopeName } from "@/lib/config";
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
  /** Same shape as members but for sub-account holders, so SubAccount* events
   *  render with the kid's display name instead of a raw C-address. */
  subaccounts?: { address: string; name: string }[];
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
  const profileByAddress = useMemo(() => {
    const out = new Map<string, { name: string; avatarUrl: string | null }>();
    for (const m of members) {
      out.set(m.address, { name: m.name, avatarUrl: m.avatarUrl });
    }
    for (const s of subaccounts ?? []) {
      // Sub-accounts don't have OAuth pictures — fall back to initials.
      out.set(s.address, { name: s.name, avatarUrl: null });
    }
    return out;
  }, [members, subaccounts]);

  const labelFor = (addr: string): string =>
    profileByAddress.get(addr)?.name ?? shortenAddress(addr);
  const avatarUrlFor = (addr: string): string | null =>
    profileByAddress.get(addr)?.avatarUrl ?? null;

  // Which activity row's detail modal is open. All rows tap through to the
  // same modal — parents get date + plain-language breakdown, advanced users
  // get the tx hash tucked into a collapsed "Advanced" section.
  const [openEvent, setOpenEvent] = useState<FeedEvent | null>(null);

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
        ordered.length === 0 &&
        !pendingDeposits?.length &&
        !pendingCashouts?.length ? (
          loading ? (
            <ActivityRowsSkeleton count={5} />
          ) : (
            <div className="sobre-activity-empty">
              <div className="ic">
                <Clock size={22} strokeWidth={1.75} />
              </div>
              <div className="msg">Activity will show up here.</div>
            </div>
          )
        ) : null}

        {ordered.map((day) => (
          <div key={day}>
            <div className="sobre-day">{day}</div>
            {groups[day].map((entry) => {
              if (entry.kind === "event") {
                const ev = entry.data;
                return (
                  <ActivityRow
                    key={`${ev.txHash}-${ev.ledger}-${ev.kind}`}
                    ev={ev}
                    isNew={ev.txHash === newestTxHash}
                    labelFor={labelFor}
                    avatarUrlFor={avatarUrlFor}
                    envelopeNames={envelopeNames}
                    onOpen={setOpenEvent}
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
      {openEvent ? (
        <ActivityDetailModal
          event={openEvent}
          members={members}
          subaccounts={subaccounts}
          envelopeNames={envelopeNames}
          completedCashout={
            openEvent.kind === "Spend" && openEvent.memo === "PDAX cashout"
              ? matchCompleted(openEvent)
              : undefined
          }
          onClose={() => setOpenEvent(null)}
        />
      ) : null}
    </aside>
  );
}

/** Terminal failed deposit row. Compact one-liner; the raw failure_reason
 *  (often a multi-KB HostError log) opens in an error modal on demand
 *  instead of dumping into the feed. */
function FailedDepositRow({ deposit }: { deposit: ActiveDepositRow }) {
  return (
    <FailureRow
      title="Deposit didn't complete"
      amountPhp={Number(deposit.amount_php)}
      createdAt={deposit.created_at}
      failureReason={deposit.failure_reason ?? null}
    />
  );
}

/** Terminal failed cashout row. Same compact treatment as deposits. */
function FailedCashoutRow({ cashout }: { cashout: ActiveCashoutRow }) {
  return (
    <FailureRow
      title="Cashout didn't complete"
      amountPhp={Number(cashout.amount_php ?? 0)}
      createdAt={cashout.created_at}
      failureReason={cashout.failure_reason ?? null}
    />
  );
}

/** Shared failure-row visual: warning icon, one-line summary, small
 *  "Show error" button that pops the raw failure text in a modal. */
function FailureRow({
  title,
  amountPhp,
  createdAt,
  failureReason,
}: {
  title: string;
  amountPhp: number;
  createdAt: string;
  failureReason: string | null;
}) {
  const [errorOpen, setErrorOpen] = useState(false);
  const time = fmtTime(createdAt);
  return (
    <>
      <div
        className="sobre-activity-item outflow"
        style={{ background: "var(--surface-alt)" }}
      >
        <div className="ic" style={{ color: "var(--sobre-danger)" }}>
          <AlertTriangle size={16} strokeWidth={2} />
        </div>
        <div className="body">
          <div className="who">
            {title}{" "}
            <span className="amt tabular" style={{ color: "var(--text-2)" }}>
              ₱{amountPhp.toLocaleString("en-PH")}
            </span>
          </div>
          <div className="meta flex items-center gap-2 flex-wrap">
            <span>{time}</span>
            {failureReason ? (
              <>
                <span aria-hidden style={{ opacity: 0.4 }}>·</span>
                <button
                  type="button"
                  onClick={() => setErrorOpen(true)}
                  className="sobre-btn-inline-link"
                  style={{
                    color: "var(--sobre-danger)",
                    fontWeight: 600,
                    fontSize: 12,
                    padding: 0,
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                  }}
                >
                  Show error
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {errorOpen && failureReason ? (
        <Sheet
          onClose={() => setErrorOpen(false)}
          ariaLabel={`${title} error`}
        >
          <h2>{title}</h2>
          <p className="sub">
            The full error returned by the provider or the on-chain
            simulation. Copy and share with support if you need help.
          </p>
          <pre
            className="tabular"
            style={{
              maxHeight: "50vh",
              overflow: "auto",
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--text-2)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: "12px 0 4px",
            }}
          >
            {failureReason}
          </pre>
          <div className="sobre-modal-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(failureReason);
              }}
              className="sobre-btn sobre-btn-soft"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setErrorOpen(false)}
              className="sobre-btn sobre-btn-soft"
            >
              Close
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** Row rendered above the on-chain bucket for a non-terminal `pdax_deposits`
 *  row. The primary tap resumes the modal at whatever phase matches the
 *  row's status. A small trash icon on the right cancels the row (marks
 *  it `failed` server-side) — visible ONLY on status='pending' because
 *  the server rejects cancel for funded/credited (money's already in
 *  flight PDAX-side), and a silent-noop trash led to "I click it and it
 *  disappears then refresh brings it back" confusion. Visibility is
 *  driven purely by props — the parent adds this row's identifier to a
 *  cancelledIds set the instant onCancel fires so the row unmounts
 *  immediately instead of relying on a local hidden timer. */
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
  const time = fmtTime(deposit.created_at);
  const statusLabel: Record<ActiveDepositRow["status"], string> = {
    pending: "Awaiting payment",
    funded: "Almost there",
    // credited/split/failed shouldn't reach this row anymore — the
    // /active route excludes them from the pending bucket. Kept as
    // fallback strings so a stale client bundle never renders "undefined".
    credited: "Ready to split",
    split: "Done",
    failed: "Failed",
  };
  const canCancel = deposit.status === "pending" && Boolean(onCancel);
  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canCancel || cancelling) return;
    setCancelling(true);
    try {
      await onCancel!(deposit.identifier);
    } finally {
      setCancelling(false);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onResume?.(deposit.identifier)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onResume?.(deposit.identifier);
        }
      }}
      className="sobre-activity-item pending"
      style={{
        cursor: "pointer",
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
      {canCancel ? (
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
  avatarUrlFor,
  envelopeNames,
  onOpen,
}: {
  ev: FeedEvent;
  isNew: boolean;
  labelFor: (addr: string) => string;
  avatarUrlFor: (addr: string) => string | null;
  envelopeNames: string[];
  /** Tap on any row opens the shared ActivityDetailModal — parents see the
   *  breakdown + date/time; advanced users can drill into the tx hash. */
  onOpen: (ev: FeedEvent) => void;
}) {
  const time = fmtTime(ev.ledgerClosedAt);

  // For rows where a household member acted (Spend / MemberJoined / etc.)
  // the left slot is their Avatar — replaces the old emoji-prefixed name and
  // makes the row scannable at a glance for non-crypto parents. Deposits
  // (external inflow) and system events (Earn/Grow toggles) fall back to
  // the small action glyph.
  const actorAddr = eventActor(ev);
  const wrap = (kindClass: string, actionGlyph: React.ReactNode, content: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onOpen(ev)}
      className={`sobre-activity-item ${kindClass} ${isNew ? "new" : ""}`}
    >
      {actorAddr ? (
        <span className="ic ic-avatar" aria-hidden>
          <Avatar
            name={labelFor(actorAddr)}
            src={avatarUrlFor(actorAddr)}
            size={40}
          />
        </span>
      ) : (
        <div className="ic">{actionGlyph}</div>
      )}
      <div className="body">{content}</div>
    </button>
  );

  // Everything below funnels through `wrap()` — no more per-row markup
  // scaffold. Each case just names its inflow/outflow tint, its action
  // glyph (used ONLY when there's no household actor to avatar), and the
  // one-line primary text. Meta line is the same time-stamp everywhere.
  const meta = <div className="meta">{time}</div>;
  const line = (content: React.ReactNode) => (
    <>
      <div className="who">{content}</div>
      {meta}
    </>
  );
  const amt = (n: bigint) => (
    <span className="amt tabular">{formatPhpLocale(n)}</span>
  );

  switch (ev.kind) {
    case "Deposit":
      return wrap(
        "inflow",
        <ArrowDownToLine size={16} strokeWidth={2} />,
        line(
          <>
            Remittance received {amt(ev.amount)}
          </>,
        ),
      );
    case "Spend": {
      const isCashout = ev.memo === "PDAX cashout";
      return wrap(
        "outflow",
        isCashout ? (
          <ArrowUpFromLine size={16} strokeWidth={2} />
        ) : (
          <ShoppingBag size={16} strokeWidth={2} />
        ),
        line(
          isCashout ? (
            <>
              {labelFor(ev.caller)} cashed out {amt(ev.amount)}
            </>
          ) : (
            <>
              {labelFor(ev.caller)} spent {amt(ev.amount)} from{" "}
              {displayEnvelopeName(ev.envelope, envelopeNames)}
            </>
          ),
        ),
      );
    }
    case "RequestCreated":
      return wrap(
        "pending",
        <Hourglass size={16} strokeWidth={2} />,
        line(
          <>
            {labelFor(ev.caller)} requested {amt(ev.amount)} from{" "}
            {displayEnvelopeName(ev.envelope, envelopeNames)}
          </>,
        ),
      );
    case "RequestApproved":
      return wrap(
        "inflow",
        <CheckCheck size={16} strokeWidth={2} />,
        line(<>Request #{ev.requestId.toString()} approved</>),
      );
    case "RequestDenied":
      return wrap(
        "outflow",
        <XIcon size={16} strokeWidth={2} />,
        line(<>Request #{ev.requestId.toString()} denied</>),
      );
    case "MemberJoined":
      return wrap(
        "inflow",
        <UserPlus size={16} strokeWidth={2} />,
        line(
          <>
            <b>{ev.name || labelFor(ev.member)}</b> joined the wallet
          </>,
        ),
      );
    case "MemberRemoved":
      return wrap(
        "outflow",
        <UserMinus size={16} strokeWidth={2} />,
        line(
          <>
            <b>{labelFor(ev.member)}</b> was removed from the wallet
          </>,
        ),
      );
    case "SubAccountFunded":
      return wrap(
        "outflow",
        <Send size={16} strokeWidth={2} />,
        line(
          <>
            Sent {amt(ev.amount)} to <b>{labelFor(ev.recipient)}</b> from{" "}
            {displayEnvelopeName(ev.envelope, envelopeNames)}
          </>,
        ),
      );
    case "SubAccountSpent": {
      const isCashout = ev.memo === "Cash out" || ev.memo === "PDAX cashout";
      return wrap(
        "outflow",
        <ArrowUpFromLine size={16} strokeWidth={2} />,
        line(
          <>
            <b>{labelFor(ev.caller)}</b> {isCashout ? "cashed out" : "spent"}{" "}
            {amt(ev.amount)}
          </>,
        ),
      );
    }
    case "SubAccountJoined":
      return wrap(
        "inflow",
        <UserPlus size={16} strokeWidth={2} />,
        line(
          <>
            <b>{labelFor(ev.subaccount)}</b> joined as a supplementary account
          </>,
        ),
      );
    case "SubAccountLockChanged":
      return wrap(
        ev.locked ? "outflow" : "inflow",
        ev.locked ? (
          <Lock size={16} strokeWidth={2} />
        ) : (
          <LockOpen size={16} strokeWidth={2} />
        ),
        line(
          <>
            <b>{labelFor(ev.subaccount)}</b>{" "}
            {ev.locked ? "was locked" : "was unlocked"}
          </>,
        ),
      );
    case "EarnEnabled":
      return wrap(
        "inflow",
        <CheckCheck size={16} strokeWidth={2} />,
        line(<>Started earning yield on Blend</>),
      );
    case "EarnSupply":
      return wrap(
        "outflow",
        <ArrowDownToLine size={16} strokeWidth={2} />,
        line(
          <>
            Moved {amt(ev.amount)} from{" "}
            {displayEnvelopeName(ev.envelope, envelopeNames)} to Earn
          </>,
        ),
      );
    case "EarnWithdraw":
      return wrap(
        "inflow",
        <ArrowUpFromLine size={16} strokeWidth={2} />,
        line(
          <>
            Withdrew {amt(ev.amount)} from Earn to{" "}
            {displayEnvelopeName(ev.envelope, envelopeNames)}
          </>,
        ),
      );
    case "GrowEnabled":
      return wrap(
        "inflow",
        <Lock size={16} strokeWidth={2} />,
        line(
          <>Turned Grow on. 48-hour cooling-off on withdrawals.</>,
        ),
      );
    case "GrowTransfer":
      return wrap(
        "outflow",
        <Lock size={16} strokeWidth={2} />,
        line(<>Locked {amt(ev.amount)} in Grow</>),
      );
    case "GrowRequest":
      return wrap(
        "pending",
        <Hourglass size={16} strokeWidth={2} />,
        line(
          <>
            Requested {amt(ev.amount)} withdrawal from Grow. 48-hour timer
            started.
          </>,
        ),
      );
    case "GrowExecute":
      return wrap(
        "inflow",
        <LockOpen size={16} strokeWidth={2} />,
        line(<>Unlocked {amt(ev.amount)} from Grow</>),
      );
    case "GrowCancel":
      return wrap(
        "inflow",
        <XIcon size={16} strokeWidth={2} />,
        line(<>Cancelled a {amt(ev.amount)} Grow withdrawal request</>),
      );
  }
}

