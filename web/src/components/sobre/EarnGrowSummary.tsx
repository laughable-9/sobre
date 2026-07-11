"use client";

import { PlantIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import type { WalletState } from "@/hooks/useWalletState";
import { EARN_APY_LABEL } from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import { formatCurrencyLocale } from "@/lib/format";

/**
 * At-a-glance Earn + Grow summary for the home tab. Renders nothing when
 * neither is active — the tab stays clean for wallets that haven't opted
 * in yet. When Earn is on, shows the Savings position's total balance +
 * interest earned + APY pill. When Grow has a locked balance, shows that
 * too so the family can see their cooling-off pool without digging into
 * the envelopes tab.
 */
export function EarnGrowSummary({
  state,
  onOpenEnvelopes,
  onEarnInfo,
}: {
  state: WalletState;
  /** Tapping a row jumps the user to the Envelopes tab so they can take
   *  action on the underlying balance / request a Grow withdrawal / etc. */
  onOpenEnvelopes: () => void;
  onEarnInfo: () => void;
}) {
  const { currency } = useCurrency();
  const savingsPos = state.earn?.positions.find(
    (p) => p.envelope === "Savings",
  );
  const savingsTotal =
    (state.balances[2] ?? 0n) + (savingsPos?.underlying ?? 0n);
  const savingsInterest = savingsPos?.interestEarned ?? 0n;

  const growPos = state.earn?.growPosition ?? null;
  const growTotal = state.grow_balance + (growPos?.underlying ?? 0n);
  const growInterest = growPos?.interestEarned ?? 0n;

  const hasEarn = state.earn !== null && (savingsPos !== undefined || state.balances[2] > 0n);
  const hasGrow = state.grow_enabled && (growTotal > 0n || state.grow_requests.length > 0);

  if (!hasEarn && !hasGrow) return null;

  return (
    <section className="sobre-summary-section" aria-label="Earn and Grow summary">
      <div className="sobre-envs-section-head">
        <h3>Yield</h3>
        <button
          type="button"
          className="sobre-envs-section-action"
          onClick={onOpenEnvelopes}
        >
          Manage
        </button>
      </div>
      <div className="sobre-summary-card">
        {hasEarn ? (
          <button
            type="button"
            className="sobre-summary-row"
            onClick={onOpenEnvelopes}
          >
            <span className="sobre-summary-ic" aria-hidden>
              <PlantIcon weight="fill" size={18} />
            </span>
            <div className="sobre-summary-body">
              <div className="sobre-summary-title-row">
                <span className="sobre-summary-title">Savings earning</span>
                <button
                  type="button"
                  className="sobre-env-earn-apy"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEarnInfo();
                  }}
                  title="Tap for how yield works"
                >
                  {EARN_APY_LABEL}
                </button>
              </div>
              <div className="sobre-summary-numbers">
                <span className="sobre-summary-total tabular">
                  {formatCurrencyLocale(savingsTotal, currency)}
                </span>
                <span className="sobre-summary-interest">
                  Interest earned{" "}
                  <span className="tabular">
                    {formatCurrencyLocale(savingsInterest, currency)}
                  </span>
                </span>
              </div>
            </div>
          </button>
        ) : null}

        {hasGrow ? (
          <button
            type="button"
            className="sobre-summary-row"
            onClick={onOpenEnvelopes}
          >
            <span className="sobre-summary-ic" aria-hidden>
              <ShieldCheckIcon weight="fill" size={18} />
            </span>
            <div className="sobre-summary-body">
              <div className="sobre-summary-title-row">
                <span className="sobre-summary-title">Locked in Grow</span>
                <span className="sobre-summary-badge">
                  {state.grow_requests.length > 0
                    ? `${state.grow_requests.length} pending`
                    : "48h lock"}
                </span>
              </div>
              <div className="sobre-summary-numbers">
                <span className="sobre-summary-total tabular">
                  {formatCurrencyLocale(growTotal, currency)}
                </span>
                {growInterest > 0n ? (
                  <span className="sobre-summary-interest">
                    Interest earned{" "}
                    <span className="tabular">
                      {formatCurrencyLocale(growInterest, currency)}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        ) : null}
      </div>
    </section>
  );
}
