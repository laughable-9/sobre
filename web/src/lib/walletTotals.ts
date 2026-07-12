/**
 * Small helpers so every "how much does this envelope hold" and "what's
 * the wallet total" reads from one source of truth. When Earn is on, an
 * envelope's real balance is its cache PLUS whatever it has in USDY;
 * spending logic pulls from either seamlessly, so the display should
 * match. Grow's total comes straight from the contract's grow_balance
 * (already USDC-equivalent via Soroswap quote).
 */

import type { WalletState } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS, type EnvelopeName } from "@/lib/config";

/** Cache balance + USDY current value for one envelope. Everything the
 *  family can access from that envelope in the same tx (spends
 *  auto-redeem the shortfall). */
export function envelopeTotalStroops(
  state: WalletState,
  index: number,
): bigint {
  const cache = state.balances[index] ?? 0n;
  const envName = ENVELOPE_LABELS[index] as EnvelopeName | undefined;
  if (!envName) return cache;
  const usdyValue =
    state.earn?.positions.find((p) => p.envelope === envName)?.currentValue ??
    0n;
  return cache + usdyValue;
}

/** Grow's real value in USDC stroops. The contract already sums the
 *  idle cache and the Blend-XLM-underlying-in-USDC-terms via a live
 *  Soroswap quote, so this is just a passthrough. */
export function growTotalStroops(state: WalletState): bigint {
  return state.grow_balance;
}

/** Wallet-wide total: every envelope's real balance + Grow's real value.
 *  Used by BalanceHero's "Total balance" number so it lines up with what
 *  the yield cards and the envelope rows show individually. */
export function walletTotalStroops(state: WalletState): bigint {
  let sum = 0n;
  for (let i = 0; i < state.balances.length; i++) {
    sum += envelopeTotalStroops(state, i);
  }
  sum += growTotalStroops(state);
  return sum;
}
