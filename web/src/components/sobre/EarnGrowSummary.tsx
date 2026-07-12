"use client";

import { PlantIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import type { WalletState } from "@/hooks/useWalletState";
import { EARN_APY_LABEL, GROW_APY_LABEL, STROOPS_PER_USDC } from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import { formatCurrencyLocale } from "@/lib/format";
import { envelopeTotalStroops, growTotalStroops } from "@/lib/walletTotals";

/**
 * At-a-glance Earn + Grow summary for the home tab. Renders nothing when
 * neither is active. Each surface is a standalone hero card; the whole
 * card is tappable and jumps to Envelopes where any action actually
 * lives (request Grow withdrawal, transfer, etc.). No section header,
 * no "Manage" link. Earn is set-and-forget so there's nothing to manage.
 */
export function EarnGrowSummary({
  state,
  onOpenEnvelopes,
  onEarnInfo,
}: {
  state: WalletState;
  onOpenEnvelopes: () => void;
  onEarnInfo: () => void;
}) {
  const { currency } = useCurrency();
  const savingsPos = state.earn?.positions.find(
    (p) => p.envelope === "Savings",
  );
  const savingsTotal = envelopeTotalStroops(state, 2);
  const savingsInterest = savingsPos?.interestEarned ?? 0n;

  const growTotal = growTotalStroops(state);
  // Hide interest when the wire doesn't yet carry the two totals
  // (pre-2026-07-12 wasm) — otherwise the formula degrades to
  // interest = balance and the card lies. See GrowPanel for the same
  // guard.
  const growTotalsKnown = state.grow_supplied_total > 0n;
  const rawGrowInterest =
    state.grow_balance +
    state.grow_withdrawn_total -
    state.grow_supplied_total;
  const growInterest =
    growTotalsKnown && rawGrowInterest > 0n ? rawGrowInterest : 0n;

  const hasEarn =
    state.earn !== null && (savingsPos !== undefined || state.balances[2] > 0n);
  const hasGrow =
    state.grow_enabled && (growTotal > 0n || state.grow_requests.length > 0);

  if (!hasEarn && !hasGrow) return null;

  return (
    <div className="sobre-yield-stack" aria-label="Earn and Grow summary">
      {hasEarn ? (
        <YieldCard
          icon={<PlantIcon weight="fill" size={22} />}
          label="Savings earning"
          balance={savingsTotal}
          interest={savingsInterest}
          currency={currency}
          apyChip={
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
        <YieldCard
          icon={<ShieldCheckIcon weight="fill" size={22} />}
          label="Grow"
          balance={growTotal}
          interest={growInterest}
          currency={currency}
          apyChip={
            <>
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
              <span className="sobre-yield-badge">
                {state.grow_requests.length > 0
                  ? `${state.grow_requests.length} pending`
                  : "48h wait"}
              </span>
            </>
          }
          onClick={onOpenEnvelopes}
        />
      ) : null}
    </div>
  );
}

function YieldCard({
  icon,
  label,
  balance,
  interest,
  currency,
  apyChip,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  balance: bigint;
  interest: bigint;
  currency: "PHP" | "USD";
  apyChip: React.ReactNode;
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
    <div
      role="button"
      tabIndex={0}
      className="sobre-yield-card"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="sobre-yield-head">
        <span className="sobre-yield-ic" aria-hidden>
          {icon}
        </span>
        <span className="sobre-yield-label">{label}</span>
        <div className="sobre-yield-chips">{apyChip}</div>
      </div>
      <div className="sobre-yield-balance tabular">
        {symbol}
        {whole}
        <span className="cents">.{cents}</span>
      </div>
      {interest > 0n ? (
        <div className="sobre-yield-interest">
          Interest earned{" "}
          <span className="tabular">
            {formatCurrencyLocale(interest, currency)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
