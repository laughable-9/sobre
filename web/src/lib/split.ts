/**
 * Deterministic per-envelope split from a total-stroops amount and a
 * `[groceries, tuition, savings]` percentage triple. Rounding remainder
 * lands in savings so the integer sum exactly matches the input — this
 * is the same rounding policy the contract's `deposit_with_split` /
 * `deposit_from_xlm` callers rely on.
 *
 * Server-safe (no client-only deps). Shared by the `useDeposit` hook
 * and the PDAX-ramp poll-status route so a future rounding-policy
 * change stays in one place.
 */
export function splitAmount(
  amountStroops: bigint,
  percents: readonly [number, number, number],
): { groceries: bigint; tuition: bigint; savings: bigint } {
  if (percents[0] + percents[1] + percents[2] !== 100) {
    throw new Error("Split percentages must sum to 100.");
  }
  const groceries = (amountStroops * BigInt(percents[0])) / 100n;
  const tuition = (amountStroops * BigInt(percents[1])) / 100n;
  const savings = amountStroops - groceries - tuition;
  return { groceries, tuition, savings };
}
