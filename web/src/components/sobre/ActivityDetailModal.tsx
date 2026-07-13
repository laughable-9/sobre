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
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const total = event.amount;
  const subtotal =
    event.subtotal ??
    (total !== null && event.tax !== null ? total - event.tax : null);
  const tax = event.tax;
  const addedLabel = formatShortDate(event.addedAt);
  const itemCount = event.items.length;
  const TAG_LIMIT = 2;
  const ITEM_LIMIT = 5;
  const tags = event.category ?? [];
  const visibleTags = tagsExpanded ? tags : tags.slice(0, TAG_LIMIT);
  const hiddenTagCount = tags.length - visibleTags.length;
  const visibleItems = itemsExpanded ? event.items : event.items.slice(0, ITEM_LIMIT);
  const hiddenItemCount = event.items.length - visibleItems.length;

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
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--text-1)",
              lineHeight: 1.15,
              marginBottom: 6,
              wordBreak: "break-word",
            }}
          >
            {event.vendor ?? "Receipt"}
          </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-3)",
            lineHeight: 1.4,
          }}
        >
          {visibleTags.map((c) => (
            <span
              key={c}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--sobre-accent)",
                background: "var(--accent-soft)",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              {c}
            </span>
          ))}
          {hiddenTagCount > 0 ? (
            <button
              type="button"
              onClick={() => setTagsExpanded(true)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-3)",
                background: "var(--sobre-surface-alt)",
                padding: "2px 8px",
                borderRadius: 999,
                border: 0,
                cursor: "pointer",
              }}
            >
              +{hiddenTagCount}
            </button>
          ) : null}
          {tags.length > 0 ? <span aria-hidden>·</span> : null}
          <span>{nameOf(event.caller).split(" ")[0]}</span>
          <span aria-hidden>·</span>
          <span>{addedLabel}</span>
        </div>
        </div>
        <button
          type="button"
          aria-label="Delete receipt"
          onClick={() => setConfirmingDelete(true)}
          disabled={deleting}
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
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

      {confirmingDelete ? (
        <div
          style={{
            background: "var(--sobre-surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 16,
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

      {event.note || event.signedReceiptUrls.length > 0 ? (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-start" }}>
          {event.signedReceiptUrls.length > 0 ? (
            <ReceiptThumb
              url={event.signedReceiptUrls[0]}
              extraCount={event.signedReceiptUrls.length - 1}
              onOpen={() => setLightboxIndex(0)}
            />
          ) : null}
          {event.note ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <NoteText note={event.note} />
            </div>
          ) : null}
        </div>
      ) : null}

      {event.items.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <SectionLabel>{itemCount} items</SectionLabel>
            {event.items.length > ITEM_LIMIT ? (
              <button
                type="button"
                onClick={() => setItemsExpanded((v) => !v)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--sobre-accent)",
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {itemsExpanded ? "Show less" : `Show all ${event.items.length}`}
              </button>
            ) : null}
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
              maxHeight: itemsExpanded ? 260 : undefined,
              overflowY: itemsExpanded ? "auto" : "visible",
            }}
          >
            {visibleItems.map((it, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  fontSize: 13,
                  background: "var(--surface)",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    color: "var(--text-1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.description || "Untitled item"}
                </span>
                <span
                  className="tabular"
                  style={{ color: "var(--text-3)", fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {it.qty} ×
                </span>
                <span
                  className="tabular"
                  style={{
                    color: "var(--text-1)",
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    minWidth: 70,
                    textAlign: "right",
                  }}
                >
                  {formatPhpLocale(BigInt(it.qty) * it.unit_price)}
                </span>
              </div>
            ))}
            {!itemsExpanded && hiddenItemCount > 0 ? (
              <button
                type="button"
                onClick={() => setItemsExpanded(true)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderTop: "1px solid var(--border)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--sobre-accent)",
                  background: "var(--sobre-surface-alt)",
                  border: 0,
                  borderRadius: 0,
                  cursor: "pointer",
                }}
              >
                + {hiddenItemCount} more
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {total !== null ? (
        <div style={{ fontSize: 13 }}>
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
              alignItems: "baseline",
              justifyContent: "space-between",
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
            }}
          >
            <span style={{ color: "var(--text-1)", fontSize: 15, fontWeight: 700 }}>
              Total
            </span>
            <span
              className="tabular"
              style={{
                color: "var(--text-1)",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {formatPhpLocale(total)}
            </span>
          </div>
        </div>
      ) : null}

      {lightboxIndex !== null ? (
        <ReceiptLightbox
          urls={event.signedReceiptUrls}
          index={lightboxIndex}
          setIndex={setLightboxIndex}
        />
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

/** Note with a 2-line clamp + expand toggle. DB caps notes at 200 chars,
 *  so worst case is ~4 lines; the clamp keeps the header block compact by
 *  default and reveals the rest on tap. */
function NoteText({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const measureRef = (el: HTMLParagraphElement | null) => {
    if (!el) return;
    // scrollHeight > clientHeight ⇒ clamped content is being hidden.
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  };
  return (
    <div>
      <p
        ref={measureRef}
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-2)",
          lineHeight: 1.5,
          display: expanded ? "block" : "-webkit-box",
          WebkitLineClamp: expanded ? undefined : 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {note}
      </p>
      {overflowing || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 4,
            padding: 0,
            background: "transparent",
            border: 0,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--sobre-accent)",
            cursor: "pointer",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

/** Tiny caps label used inside the receipt detail sheet. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "var(--text-3)",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

/** Compact clickable receipt thumbnail. Overlays a +N badge when there
 *  are additional photos of the same receipt. Tap opens the lightbox. */
function ReceiptThumb({
  url,
  extraCount,
  onOpen,
}: {
  url: string;
  extraCount: number;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View receipt"
      style={{
        position: "relative",
        width: 84,
        height: 108,
        flexShrink: 0,
        padding: 0,
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--sobre-surface-alt)",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {broken ? (
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>Unavailable</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Receipt"
          onError={() => setBroken(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
      {extraCount > 0 ? (
        <span
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            fontSize: 10,
            fontWeight: 700,
            color: "#fff",
            background: "rgba(0,0,0,0.7)",
            padding: "2px 6px",
            borderRadius: 999,
          }}
        >
          +{extraCount}
        </span>
      ) : null}
    </button>
  );
}

/** Fullscreen dark overlay showing the receipt image at natural size.
 *  Multi-photo receipts show ‹ prev / next › controls. Esc / backdrop-tap
 *  dismisses; the underlying receipt sheet stays open behind it. */
/** Round white nav button used on either side of the lightbox. Extracted so
 *  the two mirror buttons share every style prop; only `side` differs. */
function LightboxNav({
  side,
  onClick,
  label,
  children,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      style={{
        position: "absolute",
        [side]: 12,
        top: "50%",
        transform: "translateY(-50%)",
        width: 40,
        height: 40,
        borderRadius: 999,
        border: 0,
        background: "rgba(255,255,255,0.9)",
        cursor: "pointer",
        fontSize: 18,
      }}
    >
      {children}
    </button>
  );
}

function ReceiptLightbox({
  urls,
  index,
  setIndex,
}: {
  urls: string[];
  index: number;
  setIndex: (i: number | null) => void;
}) {
  const close = () => setIndex(null);
  const prev = () => setIndex(index > 0 ? index - 1 : urls.length - 1);
  const next = () => setIndex(index < urls.length - 1 ? index + 1 : 0);
  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[index]}
        alt={`Receipt ${index + 1}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 6,
        }}
      />
      {urls.length > 1 ? (
        <>
          <LightboxNav side="left" onClick={prev} label="Previous receipt">
            ‹
          </LightboxNav>
          <LightboxNav side="right" onClick={next} label="Next receipt">
            ›
          </LightboxNav>
          <div
            style={{
              position: "absolute",
              bottom: 20,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 12,
              color: "#fff",
            }}
          >
            {index + 1} / {urls.length}
          </div>
        </>
      ) : null}
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          width: 36,
          height: 36,
          borderRadius: 999,
          border: 0,
          background: "rgba(255,255,255,0.9)",
          cursor: "pointer",
          fontSize: 20,
          fontWeight: 700,
        }}
      >
        ×
      </button>
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
