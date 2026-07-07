"use client";

import type { WalletState } from "@/hooks/useWalletState";
import {
  PAYMENT_TOKEN_LABEL,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
} from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

/**
 * v2 dashboard headline card: the household's total balance, big and
 * mono-numeric, following the app-wide currency toggle. Presentational only —
 * the actions that used to sit under the total live in <QuickActions>.
 */
export function BalanceHero({
  state,
  children,
}: {
  state: WalletState;
  /** Rendered inside the card under the total — the envelope split rows
   *  (board Section 07 puts the split inside the balance card). */
  children?: React.ReactNode;
}) {
  const { currency } = useCurrency();
  const totalStroops = state.balances.reduce((acc, b) => acc + b, 0n);
  const totalToken = Number(totalStroops) / STROOPS_PER_USDC;
  const showUsd = currency === "USD";
  const totalDisplay = showUsd ? totalToken : totalToken * PHP_PER_USDC;

  return (
    <section className="sobre-v2-hero" aria-label="Total balance">
      <div className="head">
        <div className="label">Total balance</div>
        {/* Real-time-sync signature: both members see the same state live.
            Dot reuses the sobre-live-pulse keyframes (see design guides). */}
        <span
          className="live"
          title="Live — every member sees the same balances in real time"
        >
          <span className="dot" aria-hidden />
          LIVE
        </span>
      </div>
      {/* Display number is Manrope (board Section 07) — NOT the Geist Mono
          used for running numerals; the .tabular mono override must not
          apply here, so no .tabular class. */}
      <div className="amount">
        <AnimatedNumber
          value={totalDisplay}
          format={(n) => {
            const whole = Math.floor(n).toLocaleString("en-PH");
            const cents = Math.abs(n).toFixed(2).split(".")[1];
            return (
              <>
                {showUsd ? "$" : "₱"}
                {whole}
                <span className="cents">.{cents}</span>
              </>
            );
          }}
        />
      </div>
      <div className="sub">
        <span className="tabular">
          {totalToken.toFixed(4)} {PAYMENT_TOKEN_LABEL}
        </span>
        <span
          aria-hidden
          style={{
            width: 3,
            height: 3,
            borderRadius: 999,
            background: "currentColor",
            opacity: 0.7,
          }}
        />
        <span>{state.balances.length} envelopes</span>
      </div>
      {children}
    </section>
  );
}
