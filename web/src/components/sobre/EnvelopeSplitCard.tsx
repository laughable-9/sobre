"use client";

import {
  EnvelopeSimpleIcon,
} from "@phosphor-icons/react";

import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  displayEnvelopeName,
} from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import { envelopeTotalStroops } from "@/lib/walletTotals";

/** Categorical envelope colors. Kept HUE-distinct on purpose — the earlier
 *  green triad (Green 600 / 700 / 500) worked for 3 envelopes but blurred
 *  together and couldn't scale. This palette leans on the brand's own tones
 *  (green stays the primary), pairs with warm mango and cool slate for the
 *  next two slots, and rounds out with violet and teal for a 5-envelope
 *  future without overlap. Shared with SplitLegendBar and the auto-split
 *  chip strip on activity rows, so a Groceries deposit reads as the same
 *  color everywhere it appears. */
export const BAR_COLORS = [
  "#22A45C", // Groceries — brand green
  "#E8923C", // Tuition   — mango (v1 accent)
  "#2E6BAA", // Savings   — slate blue
  "#8C4EB8", // 4th slot  — violet
  "#0F9E8A", // 5th slot  — teal
] as const;

/**
 * Board Section 07 "split" card: one compact row per envelope — icon chip,
 * name, balance, and a thin progress bar showing that envelope's share of the
 * split. Rows tap through to the full envelopes view.
 */
export function EnvelopeSplitCard({
  state,
  onOpen,
}: {
  state: WalletState;
  /** Row tap-through — opens the envelopes view. */
  onOpen: () => void;
}) {
  const { currency } = useCurrency();
  const showUsd = currency === "USD";

  return (
    <div className="sobre-v2-split" role="list" aria-label="Envelope split">
      {state.balances.map((_, i) => {
        const name = displayEnvelopeName(
          ENVELOPE_LABELS[i],
          state.envelope_names,
        );
        // Cache + Blend underlying so this matches what SpendModal, the
        // envelope cards, and the yield hero all show.
        const stroops = envelopeTotalStroops(state, i);
        const token = Number(stroops) / STROOPS_PER_USDC;
        const amount = showUsd ? token : token * PHP_PER_USDC;
        const pct = state.percents[i] ?? 0;
        // pct is preserved so future budget/runway indicators can key off it
        void pct;
        return (
          <button
            key={i}
            type="button"
            role="listitem"
            className="sobre-v2-split-row"
            onClick={onOpen}
          >
            <span className="top">
              <span className="chip">
                <EnvelopeSimpleIcon weight="fill" size={15} />
              </span>
              <span className="name">{name}</span>
              <span className="amt tabular">
                {showUsd ? "$" : "₱"}
                {amount.toLocaleString("en-PH", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * PLACEHOLDER — notification pills + rail meta from the brand board
 * (Section 07 UI preview). Everything below renders STATIC SAMPLE COPY so
 * the design can be evaluated; none of it reads real data yet.
 *
 * Wire-up plan (later):
 *   • "split fired" pill  → latest Deposit event from useTxFeed
 *   • "needs 2nd approval" → pendingRequests (usePendingSpendRequests)
 *   • "over budget"        → envelope spent-vs-split from the activity feed
 *   • rail meta            → static product facts, may stay hardcoded
 *
 * Remove or replace this whole component when the real signals land.
 * ──────────────────────────────────────────────────────────────────────── */
export function HomeSignalsPlaceholder() {
  // One hue by design: every pill rides the shared Green-50 class style —
  // no per-severity colors or dot prefixes (rejected as too colorful).
  return (
    <div aria-hidden>
      {/* PLACEHOLDER pill: split fired (sample copy from the board) */}
      <div className="sobre-v2-pill-note">
        <span>
          <b>+₱500.00</b> from Riyadh · split fired
        </span>
        <span className="when">3.4s</span>
      </div>

      {/* PLACEHOLDER pill: pending second approval */}
      <div className="sobre-v2-pill-note">
        <span>
          <b>Large transfer</b> needs 2nd approval
        </span>
      </div>

      {/* PLACEHOLDER pill: over budget */}
      <div className="sobre-v2-pill-note">
        <span>
          <b>Transport</b> over budget by ₱10
        </span>
      </div>
    </div>
  );
}
