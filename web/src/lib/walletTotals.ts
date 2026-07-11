/**
 * Small helpers so every "how much does this envelope hold" and "what's
 * the wallet total" reads from one source of truth. When Earn is on, an
 * envelope's real balance is its cache PLUS whatever it has in Blend;
 * spending logic pulls from either seamlessly, so the display should
 * match. Grow's total is its cache + its Blend position.
 */

import type { WalletState } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS, type EnvelopeName } from "@/lib/config";

/** Cache balance + Blend underlying for one envelope. Everything the
 *  family can access from that envelope in the same tx (spends
 *  auto-withdraw the shortfall). */
export function envelopeTotalStroops(
  state: WalletState,
  index: number,
): bigint {
  const cache = state.balances[index] ?? 0n;
  const envName = ENVELOPE_LABELS[index] as EnvelopeName | undefined;
  if (!envName) return cache;
  const earnUnderlying =
    state.earn?.positions.find((p) => p.envelope === envName)?.underlying ??
    0n;
  return cache + earnUnderlying;
}

/** Grow's real value — cache + Blend underlying. Zero when Grow is
 *  disabled or empty. */
export function growTotalStroops(state: WalletState): bigint {
  return state.grow_balance + (state.earn?.growPosition?.underlying ?? 0n);
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
