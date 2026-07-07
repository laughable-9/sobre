"use client";

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

  return (
    <div className="sobre-v2-splitbar" aria-label="Deposit split">
      <div className="head">How every ₱100 splits</div>
      <div className="track" role="img" aria-hidden>
        {rows.map((r) =>
          r.pct > 0 ? (
            <span
              key={r.name}
              className="seg"
              style={{ width: `${r.pct}%`, background: r.color }}
            >
              {/* % rides the segment itself when there's room */}
              {r.pct >= 12 ? <b className="tabular">{r.pct}%</b> : null}
            </span>
          ) : null,
        )}
      </div>
      <div className="legend">
        {rows.map((r) => (
          <span key={r.name} className="item">
            <span className="swatch" style={{ background: r.color }} />
            {r.name}
            <b className="tabular">₱{r.pct}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
