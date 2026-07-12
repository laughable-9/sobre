"use client";

import { useState } from "react";
import { ArrowDownIcon, CaretRightIcon } from "@phosphor-icons/react";

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

/**
 * Home-tab activity preview: 3 most-recent Spend or Deposit events, ink
 * on white, no colored halos, tabular numerals. "See all" jumps to the
 * full Activity tab. Row style mirrors the redesigned Activity feed —
 * member-driven rows show the actor's Avatar; deposits show the down
 * arrow because there's no household actor. Tapping a row opens the
 * same ActivityDetailModal the full feed uses.
 */
export function RecentActivityPreview({
  events,
  loading,
  members,
  envelopeNames,
  onSeeAll,
}: {
  events: FeedEvent[];
  /** True until the tx feed's first successful RPC page returns. Without
   *  this the empty state renders during initial load and reads as "no
   *  activity yet" for a wallet that actually has activity. */
  loading: boolean;
  members: Member[];
  envelopeNames: string[];
  onSeeAll: () => void;
}) {
  const [openEvent, setOpenEvent] = useState<FeedEvent | null>(null);
  const rows = events
    .filter((e) => e.kind === "Withdraw" || e.kind === "Deposit")
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
  envelopeNames,
  onOpen,
}: {
  ev: FeedEvent;
  members: Member[];
  envelopeNames: string[];
  onOpen: (ev: FeedEvent) => void;
}) {
  const actor = eventActor(ev);
  const profile = actor
    ? members.find((m) => m.address === actor)
    : undefined;
  const actorName = profile?.name ?? (actor ? shortenAddress(actor) : "");

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
