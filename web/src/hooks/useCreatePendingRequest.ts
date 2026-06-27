"use client";

import { useCallback, useState } from "react";

import type { EnvelopeName } from "@/lib/config";
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
 */
export function useCreatePendingRequest(
  memberAddress: string | null,
): UseCreatePendingRequestResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: {
      familyWalletId: string;
      envelope: EnvelopeName;
      amountStroops: bigint;
      memo: string;
    }): Promise<void> => {
      if (!memberAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: walletRow, error: walletErr } = await supabase
          .from("wallets")
          .select("id")
          .eq("contract_id", memberAddress)
          .single();
        if (walletErr || !walletRow) {
          throw new Error("Could not resolve your wallet record.");
        }
        const { error: insertErr } = await supabase
          .from("family_pending_requests")
          .insert({
            family_wallet_id: input.familyWalletId,
            member_wallet_id: (walletRow as { id: string }).id,
            envelope: input.envelope,
            amount_stroops: input.amountStroops.toString(),
            memo: input.memo,
            status: "pending",
          });
        if (insertErr) throw new Error(insertErr.message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [memberAddress],
  );

  return { create, pending, error };
}
