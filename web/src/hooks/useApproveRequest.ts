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
      // off-then-on if the tx fails. CRITICAL: capture the update error.
      // If this silently dropped, the realtime panel would keep showing
      // "Approve" on a row whose money has already moved, and a second
      // click would double-spend (the contract has no idempotency key).
      const supabase = getSupabaseBrowserClient();
      const { error: updateErr } = await supabase
        .from("family_pending_requests")
        .update({
          status: "approved",
          resolved_at: new Date().toISOString(),
          resolved_by_wallet_id: adminWalletDbId,
          executed_spend_tx_hash: hash,
        })
        .eq("id", req.id);
      if (updateErr) {
        throw new Error(
          `Release succeeded on chain but the request status couldn't be updated (${updateErr.message}). Refresh before retrying so you don't approve twice.`,
        );
      }

      return hash;
    },
    [adminAddress, contractId, adminWalletDbId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { approve: run, pending, error };
}
