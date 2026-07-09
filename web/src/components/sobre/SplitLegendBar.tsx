"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";

import type { WalletState } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS, displayEnvelopeName } from "@/lib/config";
import { BAR_COLORS } from "@/components/sobre/EnvelopeSplitCard";

/**
 * One stacked bar showing how every deposit splits across the envelopes,
 * with a legend (swatch · name · %). Segment colors reuse BAR_COLORS so the
 * segments match each envelope's own share bar on the home split card.
 */
export function SplitLegendBar({ state }: { state: WalletState }) {
  const rows = state.balances.map((_, i) => ({
    name: displayEnvelopeName(ENVELOPE_LABELS[i], state.envelope_names),
    pct: state.percents[i] ?? 0,
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));

  // Cumulative left offset (%) for each segment, so its icon badge can be
  // positioned at the segment's own center without the badge living inside
  // .track (which clips overflow to mask the fill's rounded corners — an
  // absolutely-positioned child straddling that boundary would get cut off).
  let cursor = 0;
  const badges = rows
    .filter((r) => r.pct > 0)
    .map((r) => {
      const left = cursor + r.pct / 2;
      cursor += r.pct;
      return { ...r, left };
    });

  return (
    <div className="sobre-v2-splitbar" aria-label="Deposit split">
      <div className="head">How every deposit splits</div>
      <div className="track-wrap">
        <div className="track" role="img" aria-hidden>
          {rows.map((r) =>
            r.pct > 0 ? (
              <span
                key={r.name}
                className="seg"
                style={{ width: `${r.pct}%`, background: r.color }}
              />
            ) : null,
          )}
        </div>
        {badges.map((b) => (
          <span
            key={b.name}
            className="ic"
            style={{ left: `${b.left}%` }}
            aria-hidden
          >
            <EnvelopeSimpleIcon weight="fill" size={11} />
          </span>
        ))}
      </div>
      <div className="legend">
        {rows.map((r) => (
          <span key={r.name} className="item">
            <span className="swatch" style={{ background: r.color }} />
            {r.name}
            <b className="tabular">{r.pct}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}
