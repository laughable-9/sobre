"use client";

import type { WalletState } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS, displayEnvelopeName } from "@/lib/config";
import { BAR_COLORS } from "@/components/sobre/EnvelopeSplitCard";

/**
 * One stacked bar showing how every deposit splits across the envelopes,
 * with a legend (swatch · name · %). Segments carry the % text inline so
 * the bar is self-explanatory before you read the legend below.
 */
export function SplitLegendBar({ state }: { state: WalletState }) {
  const rows = state.balances.map((_, i) => ({
    name: displayEnvelopeName(ENVELOPE_LABELS[i], state.envelope_names),
    pct: state.percents[i] ?? 0,
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));

  return (
    <div className="sobre-v2-splitbar" aria-label="Deposit split">
      <div className="head">How every deposit splits</div>
      <div className="track" role="img" aria-hidden>
        {rows.map((r) =>
          r.pct > 0 ? (
            <span
              key={r.name}
              className="seg"
              style={{ width: `${r.pct}%`, background: r.color }}
            >
              {r.pct >= 10 ? <b className="tabular">{r.pct}%</b> : null}
            </span>
          ) : null,
        )}
      </div>
      <div className="legend">
        {rows.map((r) => (
          <span key={r.name} className="item">
            <span className="swatch" style={{ background: r.color }} />
            {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}
