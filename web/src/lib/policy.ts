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
import { SAVINGS_NAME } from "@/components/sobre/EnvelopeNamesEditor";

export type SpendRoute = "direct" | "pending" | "overspend";

export type ApprovalMode = "single_admin" | "all_admins";

export interface RouteSpendVerdict {
  route: SpendRoute;
  /** Which approval flow the pending row should use. Only meaningful when
   *  `route === "pending"`. `all_admins` is the Savings-lock flow (every
   *  admin must approve, admin originators included); `single_admin` is the
   *  default threshold/policy gate (one admin approval releases). */
  approvalMode: ApprovalMode;
}

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
  /** Family-level "lock Savings, every admin must approve" toggle. */
  savingsLockAllAdmins: boolean;
  /** Number of admins in the family. The Savings lock is a no-op when there's
   *  only one admin to approve. */
  adminCount: number;
}

export function routeSpend(input: RouteSpendInput): RouteSpendVerdict {
  // Default approval mode is single_admin. The lock-on path is the only
  // branch that overrides it. Keep this local so every return site reads
  // one line instead of restating it.
  const single = (route: SpendRoute): RouteSpendVerdict => ({
    route,
    approvalMode: "single_admin",
  });

  if (input.amountStroops <= 0n) return single("direct");
  if (input.amountStroops > input.envelopeBalanceStroops) {
    return single("overspend");
  }

  // Savings lock is checked BEFORE the admin-bypass. Unlike the threshold
  // gate (which trusts the admin), this lock is specifically designed to
  // include admins; its job is "don't drain Savings unilaterally."
  if (
    input.savingsLockAllAdmins &&
    input.adminCount > 1 &&
    input.envelope === SAVINGS_NAME
  ) {
    return { route: "pending", approvalMode: "all_admins" };
  }

  // Admin bypasses every threshold gate. Their spends are the trusted-OFW
  // transactions the policy is designed to guard against, not block.
  if (input.caller === input.admin) return single("direct");

  if (input.policy.requireAllSigs) return single("pending");
  if (input.policy.protectedEnvelopes.includes(input.envelope)) {
    return single("pending");
  }
  if (input.policy.dailyLimit !== null) {
    if (
      input.dailySpentStroops + input.amountStroops >
      input.policy.dailyLimit
    ) {
      return single("pending");
    }
  }
  if (input.policy.perTxThreshold !== null) {
    if (input.amountStroops > input.policy.perTxThreshold) {
      return single("pending");
    }
  }

  return single("direct");
}
