"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";

import type { FeedEvent } from "@/hooks/useTxFeed";
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
 * full Activity tab. Section header always renders (so the user sees the
 * surface exists); an empty state fills in when there's no activity yet.
 */
export function RecentActivityPreview({
  events,
  members,
  envelopeNames,
  onSeeAll,
}: {
  events: FeedEvent[];
  members: Member[];
  envelopeNames: string[];
  onSeeAll: () => void;
}) {
  const rows = events
    .filter((e) => e.kind === "Spend" || e.kind === "Deposit")
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
        <div className="sobre-recent-empty">
          Nothing yet. Deposits and spends will show up here.
        </div>
      ) : (
        rows.map((ev) => (
          <RecentRow
            key={ev.txHash}
            ev={ev}
            members={members}
            envelopeNames={envelopeNames}
          />
        ))
      )}
    </section>
  );
}

function RecentRow({
  ev,
  members,
  envelopeNames,
}: {
  ev: FeedEvent;
  members: Member[];
  envelopeNames: string[];
}) {
  if (ev.kind === "Deposit") {
    const label = memberLabel(ev.from, members);
    return (
      <div className="sobre-recent-row">
        <span className="ic in">
          <ArrowDownIcon weight="bold" size={16} />
        </span>
        <div className="body">
          <div className="line">
            <span className="who">{label} deposited</span>
            <span className="amt tabular">
              +{formatPhpLocale(ev.amount)}
            </span>
          </div>
          <div className="meta">{relativeTime(ev.ledgerClosedAt)}</div>
        </div>
      </div>
    );
  }

  // Spend
  if (ev.kind === "Spend") {
    const label = memberLabel(ev.caller, members);
    const env = displayEnvelopeName(
      ev.envelope as EnvelopeName,
      envelopeNames,
    );
    const isKnownEnvelope = ENVELOPE_LABELS.includes(
      ev.envelope as EnvelopeName,
    );
    return (
      <div className="sobre-recent-row">
        <span className="ic out">
          <ArrowUpIcon weight="bold" size={16} />
        </span>
        <div className="body">
          <div className="line">
            <span className="who">
              {label} spent from{" "}
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
      </div>
    );
  }

  return null;
}

function memberLabel(address: string, members: Member[]): string {
  const m = members.find((x) => x.address === address);
  return m?.name || shortenAddress(address);
}
