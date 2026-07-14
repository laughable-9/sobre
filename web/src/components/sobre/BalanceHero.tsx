"use client";

import type { WalletState } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import { walletTotalStroops } from "@/lib/walletTotals";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

/**
 * v2 dashboard headline card: the household's total balance, big and
 * mono-numeric, following the app-wide currency toggle. Presentational only —
 * money actions live in the OpenSobreSheet triggered from the bottom dock.
 */
export function BalanceHero({
  state,
  header,
  children,
}: {
  state: WalletState;
  /** Rendered inside the card ABOVE "Total balance" — carries the wallet
   *  title and the currency toggle so the hero owns the whole context. */
  header?: React.ReactNode;
  /** Rendered inside the card under the total — the envelope split rows
   *  (board Section 07 puts the split inside the balance card). */
  children?: React.ReactNode;
}) {
  const { currency } = useCurrency();
  // Includes Blend underlying per envelope + Grow so the hero number
  // matches the yield cards and envelope rows exactly (no ghost gap
  // between "Savings ₱x" in the split and "Savings earning ₱x+underlying"
  // in the yield card).
  const totalStroops = walletTotalStroops(state);
  const totalToken = Number(totalStroops) / STROOPS_PER_USDC;
  const showUsd = currency === "USD";
  const totalDisplay = showUsd ? totalToken : totalToken * PHP_PER_USDC;

  return (
    <section className="sobre-v2-hero" aria-label="Total balance">
      {header}
      <div className="label">Total balance</div>
      {/* Display number is Manrope (board Section 07) — NOT the Geist Mono
          used for running numerals; the .tabular mono override must not
          apply here, so no .tabular class. */}
      <div className="amount">
        <AnimatedNumber
          value={totalDisplay}
          format={(n) => {
            // Round to cents FIRST so whole and cents come from the same
            // rounded number — otherwise `Math.floor(n)` and `n.toFixed(2)`
            // disagree at float boundaries (n=4999.999 → whole "4,999",
            // cents "00" → renders as "4,999.00" instead of "5,000.00").
            const rounded = Math.round(Math.abs(n) * 100) / 100;
            const whole = Math.floor(rounded).toLocaleString("en-PH");
            const cents = rounded.toFixed(2).split(".")[1];
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
      {children}
    </section>
  );
}
