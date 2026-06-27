"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

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
): UseApproveRequestResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(
    async (req: PendingSpendRequest): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(req.memberAddress).toScVal(),
          envelopeScVal(req.envelope),
          nativeToScVal(req.amountStroops, { type: "i128" }),
          nativeToScVal(req.memo, { type: "string" }),
        ];
        const { hash } = await invokeWrite(contractId, "spend_on_behalf", args);

        // Mark resolved after the chain call lands so the panel doesn't blink
        // off-then-on if the tx fails. The dashboard's realtime sub picks up
        // the status flip and the row falls out of the pending list.
        const supabase = getSupabaseBrowserClient();
        const { data: adminWalletRow } = await supabase
          .from("wallets")
          .select("id")
          .eq("contract_id", adminAddress)
          .single();
        await supabase
          .from("family_pending_requests")
          .update({
            status: "approved",
            resolved_at: new Date().toISOString(),
            resolved_by_wallet_id:
              (adminWalletRow as { id: string } | null)?.id ?? null,
            executed_spend_tx_hash: hash,
          })
          .eq("id", req.id);

        return hash;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress, contractId],
  );

  return { approve, pending, error };
}
