"use client";

import { useCallback } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { envelopeScVal, invokeWrite } from "@/lib/contract";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PendingSpendRequest } from "@/hooks/usePendingSpendRequests";

export interface UseApproveRequestResult {
  /** Approves an off-chain pending request: signs a spend_on_behalf tx as
   *  admin, then flips the Supabase row to status=approved. The Realtime
   *  subscription on `family_pending_requests` removes it from the panel. */
  approve: (req: PendingSpendRequest) => Promise<string>;
  pending: boolean;
  error: string | null;
}

export function useApproveRequest(
  adminAddress: string | null,
  contractId: string | null,
  /** Admin's `wallets.id` (Supabase UUID). Stored alongside the row so the
   *  dashboard can later attribute "approved by Daddy" without re-joining. */
  adminWalletDbId: string | null,
): UseApproveRequestResult {
  const mutation = useCallback(
    async (req: PendingSpendRequest): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      const args = [
        Address.fromString(req.memberAddress).toScVal(),
        envelopeScVal(req.envelope),
        nativeToScVal(req.amountStroops, { type: "i128" }),
        nativeToScVal(req.memo, { type: "string" }),
      ];
      const { hash } = await invokeWrite(contractId, "spend_on_behalf", args);

      // Mark resolved after the chain call lands so the panel doesn't blink
      // off-then-on if the tx fails.
      const supabase = getSupabaseBrowserClient();
      await supabase
        .from("family_pending_requests")
        .update({
          status: "approved",
          resolved_at: new Date().toISOString(),
          resolved_by_wallet_id: adminWalletDbId,
          executed_spend_tx_hash: hash,
        })
        .eq("id", req.id);

      return hash;
    },
    [adminAddress, contractId, adminWalletDbId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { approve: run, pending, error };
}
