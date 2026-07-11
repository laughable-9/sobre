"use client";

import { PlantIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import type { WalletState } from "@/hooks/useWalletState";
import {
  EARN_APY_LABEL,
  GROW_APY_LABEL,
  STROOPS_PER_USDC,
} from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";
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

  const hasEarn =
    state.earn !== null && (savingsPos !== undefined || state.balances[2] > 0n);
  const hasGrow =
    state.grow_enabled && (growTotal > 0n || state.grow_requests.length > 0);

  if (!hasEarn && !hasGrow) return null;

  return (
    <section
      className="sobre-summary-section"
      aria-label="Earn and Grow summary"
    >
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
          <SummaryRow
            icon={<PlantIcon weight="fill" size={20} />}
            label="Savings earning"
            balance={savingsTotal}
            interest={savingsInterest}
            currency={currency}
            trailing={
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
            }
            onClick={onOpenEnvelopes}
          />
        ) : null}
        {hasGrow ? (
          <SummaryRow
            icon={<ShieldCheckIcon weight="fill" size={20} />}
            label="Locked in Grow"
            balance={growTotal}
            interest={growInterest}
            currency={currency}
            trailing={
              <div className="sobre-summary-trailing">
                <button
                  type="button"
                  className="sobre-env-earn-apy"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEarnInfo();
                  }}
                  title="Tap for how yield works"
                >
                  {GROW_APY_LABEL}
                </button>
                <span className="sobre-summary-badge">
                  {state.grow_requests.length > 0
                    ? `${state.grow_requests.length} pending`
                    : "48h lock"}
                </span>
              </div>
            }
            onClick={onOpenEnvelopes}
          />
        ) : null}
      </div>
    </section>
  );
}

function SummaryRow({
  icon,
  label,
  balance,
  interest,
  currency,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  balance: bigint;
  interest: bigint;
  currency: "PHP" | "USD";
  trailing: React.ReactNode;
  onClick: () => void;
}) {
  const symbol = currency === "USD" ? "$" : "₱";
  const usd = Number(balance) / STROOPS_PER_USDC;
  const fiat = currency === "USD" ? usd : usd * PHP_PER_USDC;
  const whole = Math.floor(fiat).toLocaleString(
    currency === "USD" ? "en-US" : "en-PH",
  );
  const cents = Math.abs(fiat).toFixed(2).split(".")[1];
  return (
    <button type="button" className="sobre-summary-row" onClick={onClick}>
      <span className="sobre-summary-ic" aria-hidden>
        {icon}
      </span>
      <div className="sobre-summary-body">
        <div className="sobre-summary-title-row">
          <span className="sobre-summary-title">{label}</span>
          {trailing}
        </div>
        <div className="sobre-summary-balance tabular">
          {symbol}
          {whole}
          <span className="cents">.{cents}</span>
        </div>
        {interest > 0n ? (
          <div className="sobre-summary-interest">
            Interest earned{" "}
            <span className="tabular">
              {formatCurrencyLocale(interest, currency)}
            </span>
          </div>
        ) : null}
      </div>
    </button>
  );
}
