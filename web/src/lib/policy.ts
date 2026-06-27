/**
 * Spending policy verdict — the canonical "does this spend need admin
 * approval?" decision, formerly enforced inside the Soroban contract's
 * `policy_requires_approval`. Phase 8b moved that logic off-chain to
 * Supabase (admin can change policy freely with zero fees), which means
 * the frontend now owns the verdict.
 *
 * Centralising it here keeps every consumer (SpendModal today, envelope
 * card previews + request-summary text tomorrow) reading the spec from one
 * place instead of each re-stating the OR composition.
 *
 * Verdict semantics:
 * - `"direct"`: spend goes straight through `useSpend` → on-chain.
 * - `"pending"`: stage a Supabase pending request via `useCreatePendingRequest`;
 *    admin approves later via `spend_on_behalf`.
 * - `"overspend"`: amount exceeds the envelope's balance. Caller should
 *    show an error and refuse to submit.
 */

import type { SpendPolicyShape } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export type SpendRoute = "direct" | "pending" | "overspend";

export interface RouteSpendInput {
  policy: SpendPolicyShape;
  /** Caller's smart-wallet C-address. */
  caller: string;
  /** Admin's smart-wallet C-address. */
  admin: string;
  envelope: EnvelopeName;
  /** Requested spend amount in stroops. */
  amountStroops: bigint;
  /** Stroops the caller has already spent today (from the on-chain event feed). */
  dailySpentStroops: bigint;
  /** Envelope's current balance in stroops. */
  envelopeBalanceStroops: bigint;
}

export function routeSpend(input: RouteSpendInput): SpendRoute {
  if (input.amountStroops <= 0n) return "direct"; // caller's gate; not our concern
  if (input.amountStroops > input.envelopeBalanceStroops) return "overspend";

  // Admin bypasses every gate — their spends are the trusted-OFW
  // transactions the policy is designed to guard against, not block.
  if (input.caller === input.admin) return "direct";

  if (input.policy.requireAllSigs) return "pending";
  if (input.policy.protectedEnvelopes.includes(input.envelope)) return "pending";

  if (input.policy.dailyLimit !== null) {
    if (input.dailySpentStroops + input.amountStroops > input.policy.dailyLimit) {
      return "pending";
    }
  }
  if (input.policy.perTxThreshold !== null) {
    if (input.amountStroops > input.policy.perTxThreshold) return "pending";
  }

  return "direct";
}
