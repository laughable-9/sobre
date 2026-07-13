"use client";

import { useMemo, useState } from "react";
import { CaretDownIcon, CaretUpIcon, TrashIcon } from "@phosphor-icons/react";

import { Avatar } from "@/components/sobre/Avatar";
import { Sheet } from "@/components/sobre/Sheet";
import type { ActiveCashoutRow } from "@/hooks/useActiveCashouts";
import { eventActor, type FeedEvent } from "@/hooks/useTxFeed";
import { bankName } from "@/lib/banks";
import { displayEnvelopeName } from "@/lib/config";
import {
  formatPhpLocale,
  formatShortDate,
  maskAccountNumber,
  shortenAddress,
} from "@/lib/format";

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
  onExpenseDeleted,
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
  /** Fires after the receipt-detail delete button removes the row. Parent
   *  refreshes the expense-log hook so activity + preview stay in sync. */
  onExpenseDeleted?: () => void;
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
  // Synthetic feed rows (expense_logs) have no on-chain tx to point at.
  const hasOnChainTx = !event.txHash.startsWith("expense:");

  if (event.kind === "ExpenseLog") {
    return (
      <ReceiptDetailSheet
        event={event}
        nameOf={nameOf}
        onClose={onClose}
        onDeleted={onExpenseDeleted}
      />
    );
  }

  return (
    <Sheet onClose={onClose} className="sobre-activity-detail">
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

      {hasOnChainTx ? (
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
      ) : null}
    </Sheet>
  );
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
    case "Withdraw": {
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
    case "SubAccountWithdraw": {
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
    case "ExpenseLog":
      // Handled by ReceiptDetailSheet before DetailBody is called.
      return null;
  }
}

// ── Receipt-style detail view (kind === "ExpenseLog") ──────────────────────

/**
 * Invoice-style layout for a logged receipt. Shows the merchant + category
 * chip + dates + total up top, an AI-generated narration, every scanned
 * line item, the saved invoice image, and the subtotal/tax/total block.
 */
function ReceiptDetailSheet({
  event,
  nameOf,
  onClose,
  onDeleted,
}: {
  event: Extract<FeedEvent, { kind: "ExpenseLog" }>;
  nameOf: (addr: string) => string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const total = event.amount;
  const subtotal =
    event.subtotal ??
    (total !== null && event.tax !== null ? total - event.tax : null);
  const tax = event.tax;
  const dateLabel = event.occurredAt
    ? formatShortDate(event.occurredAt)
    : null;
  const addedLabel = formatShortDate(event.addedAt);
  const itemCount = event.items.length;

  const deleteRow = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/expense-logs?id=${event.logId}&family_wallet_id=${event.familyWalletId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onDeleted?.();
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <Sheet
      onClose={onClose}
      canClose={!deleting}
      className="sobre-receipt-detail"
      ariaLabel="Receipt"
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
              color: "var(--text-1)",
              lineHeight: 1.2,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{event.vendor ?? "Receipt"}</span>
            {(event.category ?? []).map((c) => (
              <span
                key={c}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--sobre-accent)",
                  background: "var(--accent-soft)",
                  padding: "3px 8px",
                  borderRadius: 6,
                  letterSpacing: "0.04em",
                }}
              >
                {c.toUpperCase()}
              </span>
            ))}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              marginTop: 4,
            }}
          >
            {dateLabel ? <>Date: {dateLabel} · </> : null}
            Added: {addedLabel} · Logged by {nameOf(event.caller)}
          </div>
        </div>
        {total !== null ? (
          <div
            style={{
              textAlign: "right",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>
                {formatPhpLocale(total)}
              </div>
              {itemCount > 0 ? (
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Delete receipt"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting}
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                display: "grid",
                placeItems: "center",
                color: "var(--sobre-danger)",
                cursor: deleting ? "not-allowed" : "pointer",
              }}
            >
              <TrashIcon size={14} weight="bold" />
            </button>
          </div>
        ) : null}
      </div>

      {confirmingDelete ? (
        <div
          style={{
            background: "var(--sobre-surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-1)", marginBottom: 10 }}>
            Delete this receipt?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="sobre-btn sobre-btn-soft"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sobre-btn sobre-btn-primary"
              onClick={() => void deleteRow()}
              disabled={deleting}
              style={{
                flex: 1,
                background: "var(--sobre-danger)",
                boxShadow: "none",
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
          {deleteError ? (
            <p
              className="text-xs break-all"
              style={{ color: "var(--sobre-danger)", marginTop: 8 }}
            >
              {deleteError}
            </p>
          ) : null}
        </div>
      ) : null}

      {event.note ? (
        <div
          style={{
            background: "var(--accent-soft)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--sobre-accent)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            AI Review Narration
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-1)",
              fontStyle: "italic",
              lineHeight: 1.4,
            }}
          >
            &ldquo;{event.note}&rdquo;
          </div>
        </div>
      ) : null}

      {event.items.length > 0 ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 40px 80px 90px",
              gap: 8,
              padding: "10px 12px",
              background: "var(--sobre-surface-alt)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--text-3)",
              textTransform: "uppercase",
            }}
          >
            <span>Item</span>
            <span style={{ textAlign: "right" }}>Qty</span>
            <span style={{ textAlign: "right" }}>Price</span>
            <span style={{ textAlign: "right" }}>Type</span>
          </div>
          {event.items.map((it, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 40px 80px 90px",
                gap: 8,
                padding: "10px 12px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                fontSize: 13,
                alignItems: "center",
              }}
            >
              <span style={{ color: "var(--text-1)" }}>{it.description}</span>
              <span className="tabular" style={{ textAlign: "right", color: "var(--text-2)" }}>
                {it.qty}
              </span>
              <span className="tabular" style={{ textAlign: "right", color: "var(--text-1)" }}>
                {formatPhpLocale(BigInt(it.qty) * it.unit_price)}
              </span>
              <span style={{ textAlign: "right" }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--sobre-accent)",
                    background: "var(--accent-soft)",
                    padding: "3px 6px",
                    borderRadius: 5,
                    letterSpacing: "0.04em",
                  }}
                >
                  {it.category.toUpperCase()}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {event.signedReceiptUrls.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--text-3)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Saved invoice document
            {event.signedReceiptUrls.length > 1 ? (
              <> · {event.signedReceiptUrls.length} photos</>
            ) : null}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                event.signedReceiptUrls.length === 1
                  ? "1fr"
                  : "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 8,
            }}
          >
            {event.signedReceiptUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Receipt ${i + 1}`}
                style={{
                  width: "100%",
                  maxHeight: 320,
                  objectFit: "contain",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--sobre-surface-alt)",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {total !== null ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            fontSize: 13,
          }}
        >
          {subtotal !== null ? (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--text-3)" }}>Subtotal</span>
              <span className="tabular" style={{ color: "var(--text-1)" }}>
                {formatPhpLocale(subtotal)}
              </span>
            </div>
          ) : null}
          {tax !== null ? (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--text-3)" }}>Tax / VAT</span>
              <span className="tabular" style={{ color: "var(--text-1)" }}>
                {formatPhpLocale(tax)}
              </span>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 700,
              fontSize: 14,
              marginTop: 6,
            }}
          >
            <span style={{ color: "var(--text-1)" }}>Receipt total</span>
            <span className="tabular" style={{ color: "var(--text-1)" }}>
              {formatPhpLocale(total)}
            </span>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
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
    case "Withdraw":
      return ev.memo === "PDAX cashout" ? "Cash out" : "Withdrew from envelope";
    case "RequestCreated":
      return "Withdrawal request";
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
    case "SubAccountWithdraw":
      return "Sub-account cash out";
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
    case "ExpenseLog":
      return "Logged expense";
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
