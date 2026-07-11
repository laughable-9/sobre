"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";

import { Avatar } from "@/components/sobre/Avatar";
import type { ActiveCashoutRow } from "@/hooks/useActiveCashouts";
import { eventActor, type FeedEvent } from "@/hooks/useTxFeed";
import { bankName } from "@/lib/banks";
import { displayEnvelopeName } from "@/lib/config";
import {
  formatPhpLocale,
  maskAccountNumber,
  shortenAddress,
} from "@/lib/format";
import { backdropClose } from "@/lib/ui";

/**
 * Row-tap detail modal. Every activity row opens this same modal — the
 * design goal is that parents (non-crypto users) get date/time and a plain-
 * language breakdown up top, and the raw transaction id is tucked into a
 * collapsed "Advanced" section for the members who care about it. The row
 * itself stays terse; anything a user might want to inspect lives here.
 */
export function ActivityDetailModal({
  event,
  members,
  subaccounts,
  envelopeNames,
  completedCashout,
  onClose,
}: {
  event: FeedEvent;
  members: { address: string; name: string; avatarUrl: string | null }[];
  subaccounts?: { address: string; name: string }[];
  envelopeNames: string[];
  /** When the event is a PDAX-cashout Spend and we've matched its paid
   *  bank row, this row is passed in so the modal can render the
   *  destination bank + masked account. */
  completedCashout?: ActiveCashoutRow;
  onClose: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const actor = eventActor(event);
  const kind = kindLabel(event);
  const profileByAddress = useMemo(() => {
    const out = new Map<
      string,
      { name: string; avatarUrl: string | null }
    >();
    for (const m of members) {
      out.set(m.address, { name: m.name, avatarUrl: m.avatarUrl });
    }
    for (const s of subaccounts ?? []) {
      out.set(s.address, { name: s.name, avatarUrl: null });
    }
    return out;
  }, [members, subaccounts]);
  const nameOf = (addr: string) =>
    profileByAddress.get(addr)?.name ?? shortenAddress(addr);
  const avatarOf = (addr: string) =>
    profileByAddress.get(addr)?.avatarUrl ?? null;

  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${event.txHash}`;
  const hasDetails = detailsShouldRender(event);

  // Drag-to-close for the mobile bottom-sheet layout. Desktop still renders
  // as a centered dialog — the drag is scoped to a small handle strip at
  // the top of the sheet so scrolling inside the modal body doesn't
  // accidentally start a dismiss. `dragging` doubles as a "no transition"
  // signal: while the pointer is down we follow it 1:1, and the spring-
  // back or slide-out animation kicks in only after release.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const dragStartRef = useRef<number | null>(null);
  const CLOSE_THRESHOLD = 100;
  const CLOSE_ANIM_MS = 220;

  // Any dismiss path (backdrop click, drag past threshold) just flips
  // `closing`; the effect below schedules the real onClose after the
  // slide-down animation and auto-cleans up if the parent unmounts under
  // us (so onClose never fires on a dead component).
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onClose, CLOSE_ANIM_MS);
    return () => window.clearTimeout(t);
  }, [closing, onClose]);

  const beginClose = () => {
    if (!closing) setClosing(true);
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    const delta = e.clientY - dragStartRef.current;
    setDragY(delta > 0 ? delta : 0);
  };
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
    setDragging(false);
    if (dragY > CLOSE_THRESHOLD) {
      // Reset the inline translate so the CSS slide-down animation runs
      // from its "at rest" 0 → 100% instead of jumping past its from-frame.
      setDragY(0);
      beginClose();
    } else {
      setDragY(0);
    }
  };

  // Portal to document.body so the fixed-position sheet escapes any
  // ancestor stacking context (Reveal wraps the home tab in a
  // transform + will-change container, which was trapping the modal
  // BEHIND the bottom dock). SSR-safe via typeof window guard.
  if (typeof window === "undefined") return null;
  const content = (
    <div
      className={`sobre-modal-bg${closing ? " closing" : ""}`}
      onMouseDown={backdropClose(beginClose)}
    >
      <div
        className={`sobre-modal sobre-activity-detail has-own-handle${closing ? " closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : "transform 0.2s ease",
        }}
      >
        {/* Drag handle strip — visible only on the mobile bottom-sheet
            layout via CSS. Owns the pointer capture so scrolling inside
            the modal body doesn't fight with the dismiss gesture. */}
        <div
          className="sobre-activity-detail-handle-strip"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          aria-hidden
        >
          <div className="sobre-activity-detail-handle" />
        </div>

        {/* Header — either the actor's avatar or a coloured tint block for
            envelope-scoped events (deposits, Earn/Grow moves). */}
        <header className="sobre-activity-detail-head">
          {actor ? (
            <Avatar
              name={nameOf(actor)}
              src={avatarOf(actor)}
              size={48}
            />
          ) : (
            <div className="sobre-activity-detail-glyph" aria-hidden />
          )}
          <div className="sobre-activity-detail-title">
            <div className="k">{kind}</div>
            <div className="when">{formatFullTime(event.ledgerClosedAt)}</div>
          </div>
        </header>

        {hasDetails ? (
          <div className="sobre-activity-detail-body">
            <DetailBody
              event={event}
              envelopeNames={envelopeNames}
              nameOf={nameOf}
              completedCashout={completedCashout}
            />
          </div>
        ) : null}

        <div className="sobre-activity-detail-advanced">
          <button
            type="button"
            className="sobre-activity-detail-advanced-toggle"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
          >
            <span>Advanced</span>
            {advancedOpen ? (
              <CaretUpIcon weight="bold" size={12} />
            ) : (
              <CaretDownIcon weight="bold" size={12} />
            )}
          </button>
          {advancedOpen ? (
            <div className="sobre-activity-detail-advanced-body">
              <div className="sobre-activity-detail-row">
                <span className="k">Transaction ID</span>
                <span className="v tabular">{shortHash(event.txHash)}</span>
              </div>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="sobre-activity-detail-explorer"
              >
                View on Stellar Expert ↗
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

/** Some event kinds (EarnEnabled, GrowEnabled) carry no useful body — the
 *  header already says everything. Skip rendering the details section
 *  entirely for those so the modal is just Header + Advanced, rather than
 *  showing a redundant "Feature: X is now on" restatement. */
function detailsShouldRender(ev: FeedEvent): boolean {
  return ev.kind !== "EarnEnabled" && ev.kind !== "GrowEnabled";
}

function DetailBody({
  event: ev,
  envelopeNames,
  nameOf,
  completedCashout,
}: {
  event: FeedEvent;
  envelopeNames: string[];
  nameOf: (addr: string) => string;
  completedCashout?: ActiveCashoutRow;
}) {
  switch (ev.kind) {
    case "Deposit":
      return (
        <>
          <BigAmount amount={ev.amount} tone="in" />
          <div className="sobre-activity-detail-splits">
            <SplitRow
              index={0}
              label={displayEnvelopeName("Groceries", envelopeNames)}
              amount={ev.groceries}
            />
            <SplitRow
              index={1}
              label={displayEnvelopeName("Tuition", envelopeNames)}
              amount={ev.tuition}
            />
            <SplitRow
              index={2}
              label={displayEnvelopeName("Savings", envelopeNames)}
              amount={ev.savings}
            />
          </div>
        </>
      );
    case "Spend": {
      const isCashout = ev.memo === "PDAX cashout";
      return (
        <>
          <BigAmount amount={ev.amount} tone="out" />
          <KVRow k="By" v={nameOf(ev.caller)} />
          <KVRow k="From" v={displayEnvelopeName(ev.envelope, envelopeNames)} />
          {ev.memo && !isCashout ? <KVRow k="Note" v={`"${ev.memo}"`} /> : null}
          {isCashout && completedCashout ? (
            <KVRow
              k="Sent to"
              v={`${bankName(completedCashout.beneficiary_bank_code)} ${maskAccountNumber(
                completedCashout.beneficiary_account_number,
              )}`}
            />
          ) : null}
        </>
      );
    }
    case "RequestCreated":
      return (
        <>
          <BigAmount amount={ev.amount} tone="pending" />
          <KVRow k="Requested by" v={nameOf(ev.caller)} />
          <KVRow k="From" v={displayEnvelopeName(ev.envelope, envelopeNames)} />
          {ev.memo ? <KVRow k="Note" v={`"${ev.memo}"`} /> : null}
          <KVRow k="Status" v="Awaiting approval" />
        </>
      );
    case "RequestApproved":
      return <KVRow k="Request" v={`#${ev.requestId.toString()} approved`} />;
    case "RequestDenied":
      return <KVRow k="Request" v={`#${ev.requestId.toString()} denied`} />;
    case "MemberJoined":
      return (
        <>
          <KVRow k="Who" v={ev.name || nameOf(ev.member)} />
          <KVRow k="Joined" v="Family wallet" />
        </>
      );
    case "MemberRemoved":
      return (
        <>
          <KVRow k="Who" v={nameOf(ev.member)} />
          <KVRow k="Removed from" v="Family wallet" />
        </>
      );
    case "SubAccountJoined":
      return <KVRow k="Sub-account" v={nameOf(ev.subaccount)} />;
    case "SubAccountFunded":
      return (
        <>
          <BigAmount amount={ev.amount} tone="out" />
          <KVRow k="To" v={nameOf(ev.recipient)} />
          <KVRow k="From" v={displayEnvelopeName(ev.envelope, envelopeNames)} />
        </>
      );
    case "SubAccountSpent": {
      const isCashout = ev.memo === "Cash out" || ev.memo === "PDAX cashout";
      return (
        <>
          <BigAmount amount={ev.amount} tone="out" />
          <KVRow k="By" v={nameOf(ev.caller)} />
          {ev.memo && !isCashout ? <KVRow k="Note" v={`"${ev.memo}"`} /> : null}
          {isCashout ? <KVRow k="Kind" v="Cash out" /> : null}
        </>
      );
    }
    case "SubAccountLockChanged":
      return (
        <>
          <KVRow k="Sub-account" v={nameOf(ev.subaccount)} />
          <KVRow k="State" v={ev.locked ? "Locked" : "Unlocked"} />
        </>
      );
    case "EarnEnabled":
      return <KVRow k="Feature" v="Earn is now on for Savings" />;
    case "EarnSupply":
      return (
        <>
          <BigAmount amount={ev.amount} tone="out" />
          <KVRow k="Moved from" v={displayEnvelopeName(ev.envelope, envelopeNames)} />
          <KVRow k="Moved to" v="Earn" />
        </>
      );
    case "EarnWithdraw":
      return (
        <>
          <BigAmount amount={ev.amount} tone="in" />
          <KVRow k="Moved from" v="Earn" />
          <KVRow k="Moved to" v={displayEnvelopeName(ev.envelope, envelopeNames)} />
        </>
      );
    case "GrowEnabled":
      return <KVRow k="Feature" v="Grow is now on. Withdrawals have a 48-hour cooling-off period." />;
    case "GrowTransfer":
      return (
        <>
          <BigAmount amount={ev.amount} tone="out" />
          <KVRow k="Locked in" v="Grow" />
        </>
      );
    case "GrowRequest":
      return (
        <>
          <BigAmount amount={ev.amount} tone="pending" />
          <KVRow k="Requested by" v={nameOf(ev.requester)} />
          <KVRow k="Unlocks" v={formatFullTime(unlockAtToIso(ev.unlockAt))} />
        </>
      );
    case "GrowExecute":
      return (
        <>
          <BigAmount amount={ev.amount} tone="in" />
          <KVRow k="By" v={nameOf(ev.requester)} />
          <KVRow k="Released from" v="Grow" />
        </>
      );
    case "GrowCancel":
      return (
        <>
          <BigAmount amount={ev.amount} tone="pending" />
          <KVRow k="By" v={nameOf(ev.requester)} />
          <KVRow k="Cancelled" v="Grow withdrawal request" />
        </>
      );
  }
}

function KVRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="sobre-activity-detail-row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function BigAmount({
  amount,
  tone,
}: {
  amount: bigint;
  tone: "in" | "out" | "pending";
}) {
  const prefix = tone === "in" ? "+" : tone === "out" ? "-" : "";
  return (
    <div className={`sobre-activity-detail-amount ${tone}`}>
      {prefix}
      {formatPhpLocale(amount)}
    </div>
  );
}

function SplitRow({
  index,
  label,
  amount,
}: {
  index: number;
  label: string;
  amount: bigint;
}) {
  return (
    <div className="sobre-activity-detail-split-row">
      <span className={`swatch c${index}`} aria-hidden />
      <span className="name">{label}</span>
      <span className="amt tabular">{formatPhpLocale(amount)}</span>
    </div>
  );
}

function kindLabel(ev: FeedEvent): string {
  switch (ev.kind) {
    case "Deposit":
      return "Remittance received";
    case "Spend":
      return ev.memo === "PDAX cashout" ? "Cash out" : "Spent from envelope";
    case "RequestCreated":
      return "Spend request";
    case "RequestApproved":
      return "Request approved";
    case "RequestDenied":
      return "Request denied";
    case "MemberJoined":
      return "Joined the wallet";
    case "MemberRemoved":
      return "Removed from wallet";
    case "SubAccountJoined":
      return "Sub-account added";
    case "SubAccountFunded":
      return "Sent to sub-account";
    case "SubAccountSpent":
      return "Sub-account spent";
    case "SubAccountLockChanged":
      return "Sub-account lock changed";
    case "EarnEnabled":
      return "Earn turned on";
    case "EarnSupply":
      return "Moved to Earn";
    case "EarnWithdraw":
      return "Moved from Earn";
    case "GrowEnabled":
      return "Grow turned on";
    case "GrowTransfer":
      return "Locked in Grow";
    case "GrowRequest":
      return "Grow withdrawal requested";
    case "GrowExecute":
      return "Grow withdrawal released";
    case "GrowCancel":
      return "Grow withdrawal cancelled";
  }
}

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function unlockAtToIso(unlockAt: bigint): string {
  return new Date(Number(unlockAt) * 1000).toISOString();
}

function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
