"use client";

import { useCallback } from "react";

import type { EnvelopeName } from "@/lib/config";
import type { ApprovalMode } from "@/lib/policy";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PendingRequestKind = "member_spend" | "subaccount_fund";

export interface CreatePendingRequestInput {
  familyWalletId: string;
  envelope: EnvelopeName;
  amountStroops: bigint;
  memo: string;
  /** Defaults to `single_admin` (threshold gate). Set to `all_admins` for
   *  the Savings-lock flow where every admin must record an approval. */
  approvalMode?: ApprovalMode;
  /** Defaults to `member_spend` (resolves via spend_on_behalf). Set to
   *  `subaccount_fund` when the originating action was an admin funding a
   *  sub-account from Savings (resolves via fund_subaccount instead). */
  kind?: PendingRequestKind;
  /** Required when kind === 'subaccount_fund': the recipient sub-account
   *  holder's smart-wallet C-address. */
  recipientAddress?: string;
}

export interface UseCreatePendingRequestResult {
  create: (input: CreatePendingRequestInput) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/**
 * Member-side hook. Creates a family_pending_requests row when their spend
 * would exceed the family's Supabase-stored policy (require_all_sigs,
 * protected envelope, daily limit, per-tx threshold, or Savings lock). No
 * chain call. The row sits in Supabase until admin(s) approve or deny.
 * RLS gates the insert to a member's own family + own wallet.
 *
 * The originator's wallet_id is auto-recorded in `approvers_wallet_ids` so
 * the count starts at 1. Meaningful when an admin originates an
 * all_admins-mode row (their own approval counts toward the N-of-N).
 *
 * Member's `wallets.id` is resolved once at the dashboard level and passed
 * in; we don't re-query it per call.
 */
export function useCreatePendingRequest(
  memberAddress: string | null,
  memberWalletDbId: string | null,
): UseCreatePendingRequestResult {
  const mutation = useCallback(
    async (input: CreatePendingRequestInput): Promise<void> => {
      if (!memberAddress) throw new Error("Wallet not connected.");
      if (!memberWalletDbId) {
        throw new Error("Your member record hasn't loaded yet. Try again in a moment.");
      }
      const kind = input.kind ?? "member_spend";
      if (kind === "subaccount_fund" && !input.recipientAddress) {
        throw new Error("Sub-account funding request needs a recipient address.");
      }
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("family_pending_requests")
        .insert({
          family_wallet_id: input.familyWalletId,
          member_wallet_id: memberWalletDbId,
          envelope: input.envelope,
          amount_stroops: input.amountStroops.toString(),
          memo: input.memo,
          status: "pending",
          approval_mode: input.approvalMode ?? "single_admin",
          kind,
          recipient_address:
            kind === "subaccount_fund" ? input.recipientAddress : null,
          approvers_wallet_ids: [memberWalletDbId],
        });
      if (error) throw new Error(error.message);
    },
    [memberAddress, memberWalletDbId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { create: run, pending, error };
}
