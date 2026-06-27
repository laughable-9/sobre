"use client";

import { useCallback } from "react";

import type { EnvelopeName } from "@/lib/config";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UseCreatePendingRequestResult {
  create: (input: {
    familyWalletId: string;
    envelope: EnvelopeName;
    amountStroops: bigint;
    memo: string;
  }) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/**
 * Member-side hook. Creates a family_pending_requests row when their spend
 * would exceed the family's Supabase-stored policy (require_all_sigs,
 * protected envelope, daily limit, or per-tx threshold). No chain call —
 * the row sits in Supabase until admin approves (→ spend_on_behalf) or
 * denies. RLS gates the insert to a member's own family + own wallet.
 *
 * Member's `wallets.id` is resolved once at the dashboard level and passed
 * in; we don't re-query it per call.
 */
export function useCreatePendingRequest(
  memberAddress: string | null,
  memberWalletDbId: string | null,
): UseCreatePendingRequestResult {
  const mutation = useCallback(
    async (input: {
      familyWalletId: string;
      envelope: EnvelopeName;
      amountStroops: bigint;
      memo: string;
    }): Promise<void> => {
      if (!memberAddress) throw new Error("Wallet not connected.");
      if (!memberWalletDbId) {
        throw new Error("Your member record hasn't loaded yet — try again in a moment.");
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
        });
      if (error) throw new Error(error.message);
    },
    [memberAddress, memberWalletDbId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { create: run, pending, error };
}
