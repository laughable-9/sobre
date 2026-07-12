"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CaretRightIcon } from "@phosphor-icons/react";

import { ActivityDetailModal } from "@/components/sobre/ActivityDetailModal";
import { Avatar } from "@/components/sobre/Avatar";
import { SkeletonBlock } from "@/components/sobre/Skeletons";
import { eventActor, type FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { formatPhpLocale, relativeTime, shortenAddress } from "@/lib/format";

interface SubaccountRef {
  address: string;
  name: string;
}

/**
 * Home-tab activity preview: 3 most-recent money-moving events. Deposits,
 * withdrawals from envelopes, top-ups to supplementary accounts, and
 * supplementary cashouts — everything else (invites, member changes,
 * lock toggles, Earn/Grow admin ops) lives on the full Activity tab.
 * "See all" jumps there. Tapping a row opens the same
 * ActivityDetailModal the full feed uses.
 */
export function RecentActivityPreview({
  events,
  loading,
  members,
  subaccounts = [],
  envelopeNames,
  onSeeAll,
}: {
  events: FeedEvent[];
  /** True until the tx feed's first successful RPC page returns. Without
   *  this the empty state renders during initial load and reads as "no
   *  activity yet" for a wallet that actually has activity. */
  loading: boolean;
  members: Member[];
  /** Address → display-name lookup for SubAccountFunded / SubAccountWithdraw
   *  rows. Omit if the wallet has no supplementary accounts — those rows
   *  fall back to a shortened address. */
  subaccounts?: SubaccountRef[];
  envelopeNames: string[];
  onSeeAll: () => void;
}) {
  const [openEvent, setOpenEvent] = useState<FeedEvent | null>(null);
  const rows = events
    .filter(
      (e) =>
        e.kind === "Withdraw" ||
        e.kind === "Deposit" ||
        e.kind === "SubAccountFunded" ||
        e.kind === "SubAccountWithdraw",
    )
    .slice(0, 3);

  return (
    <section className="sobre-recent" aria-label="Recent activity">
      <div className="sobre-recent-head">
        <h3>Recent activity</h3>
        {rows.length > 0 ? (
          <button
            type="button"
            className="sobre-recent-see-all"
            onClick={onSeeAll}
          >
            See all
            <CaretRightIcon weight="bold" size={12} />
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        loading ? (
          <RecentRowsSkeleton />
        ) : (
          <div className="sobre-recent-empty">
            Nothing yet. Deposits and spends will show up here.
          </div>
        )
      ) : (
        rows.map((ev) => (
          <RecentRow
            key={ev.txHash}
            ev={ev}
            members={members}
            subaccounts={subaccounts}
            envelopeNames={envelopeNames}
            onOpen={setOpenEvent}
          />
        ))
      )}
      {openEvent ? (
        <ActivityDetailModal
          event={openEvent}
          members={members}
          envelopeNames={envelopeNames}
          onClose={() => setOpenEvent(null)}
        />
      ) : null}
    </section>
  );
}

function RecentRowsSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="sobre-recent-row"
          style={{ pointerEvents: "none", cursor: "default" }}
        >
          <span
            className="ic"
            style={{
              background: "var(--sobre-surface-alt)",
              width: 36,
              height: 36,
              borderRadius: 12,
            }}
          />
          <div className="body">
            <div className="line">
              <SkeletonBlock width="55%" height={14} />
              <SkeletonBlock width={68} height={14} />
            </div>
            <SkeletonBlock
              width={80}
              height={11}
              style={{ marginTop: 6 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentRow({
  ev,
  members,
  subaccounts,
  envelopeNames,
  onOpen,
}: {
  ev: FeedEvent;
  members: Member[];
  subaccounts: SubaccountRef[];
  envelopeNames: string[];
  onOpen: (ev: FeedEvent) => void;
}) {
  const actor = eventActor(ev);
  const profile = actor
    ? members.find((m) => m.address === actor)
    : undefined;
  const actorName = profile?.name ?? (actor ? shortenAddress(actor) : "");
  const subName = (addr: string) =>
    subaccounts.find((s) => s.address === addr)?.name ?? shortenAddress(addr);

  if (ev.kind === "Deposit") {
    return (
      <button
        type="button"
        onClick={() => onOpen(ev)}
        className="sobre-recent-row"
      >
        <span className="ic in">
          <ArrowDownIcon weight="bold" size={16} />
        </span>
        <div className="body">
          <div className="line">
            <span className="who">Remittance received</span>
            <span className="amt tabular">
              +{formatPhpLocale(ev.amount)}
            </span>
          </div>
          <div className="meta">{relativeTime(ev.ledgerClosedAt)}</div>
        </div>
      </button>
    );
  }

  if (ev.kind === "SubAccountFunded") {
    const env = displayEnvelopeName(
      ev.envelope as EnvelopeName,
      envelopeNames,
    );
    const isKnownEnvelope = ENVELOPE_LABELS.includes(
      ev.envelope as EnvelopeName,
    );
    return (
      <button
        type="button"
        onClick={() => onOpen(ev)}
        className="sobre-recent-row"
      >
        <span className="ic ic-avatar" aria-hidden>
          <Avatar name={subName(ev.recipient)} src={null} size={32} />
        </span>
        <div className="body">
          <div className="line">
            <span className="who">
              Sent to <b>{subName(ev.recipient)}</b> from{" "}
              <span className="env-name">
                {isKnownEnvelope ? env : ev.envelope}
              </span>
            </span>
            <span className="amt tabular">−{formatPhpLocale(ev.amount)}</span>
          </div>
          <div className="meta">{relativeTime(ev.ledgerClosedAt)}</div>
        </div>
      </button>
    );
  }

  if (ev.kind === "SubAccountWithdraw") {
    const name = subName(ev.caller);
    const isCashout =
      ev.memo === "Cash out" || ev.memo === "PDAX cashout";
    return (
      <button
        type="button"
        onClick={() => onOpen(ev)}
        className="sobre-recent-row"
      >
        <span className="ic out">
          <ArrowUpIcon weight="bold" size={16} />
        </span>
        <div className="body">
          <div className="line">
            <span className="who">
              <b>{name}</b> {isCashout ? "cashed out" : "withdrew"}
            </span>
            <span className="amt tabular">−{formatPhpLocale(ev.amount)}</span>
          </div>
          <div className="meta">
            {ev.memo && !isCashout ? `${ev.memo} · ` : ""}
            {relativeTime(ev.ledgerClosedAt)}
          </div>
        </div>
      </button>
    );
  }

  // Withdraw
  if (ev.kind === "Withdraw") {
    const env = displayEnvelopeName(
      ev.envelope as EnvelopeName,
      envelopeNames,
    );
    const isKnownEnvelope = ENVELOPE_LABELS.includes(
      ev.envelope as EnvelopeName,
    );
    return (
      <button
        type="button"
        onClick={() => onOpen(ev)}
        className="sobre-recent-row"
      >
        <span className="ic ic-avatar" aria-hidden>
          <Avatar
            name={actorName || "?"}
            src={profile?.avatarUrl ?? null}
            size={32}
          />
        </span>
        <div className="body">
          <div className="line">
            <span className="who">
              {actorName} withdrew from{" "}
              <span className="env-name">
                {isKnownEnvelope ? env : ev.envelope}
              </span>
            </span>
            <span className="amt tabular">
              −{formatPhpLocale(ev.amount)}
            </span>
          </div>
          <div className="meta">
            {ev.memo ? `${ev.memo} · ` : ""}
            {relativeTime(ev.ledgerClosedAt)}
          </div>
        </div>
      </button>
    );
  }

  return null;
}
