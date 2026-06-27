"use client";

import { useCallback } from "react";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PendingSpendRequest } from "@/hooks/usePendingSpendRequests";

export interface UseDenyRequestResult {
  /** Marks the Supabase row as denied. No chain call, no fee. */
  deny: (req: PendingSpendRequest) => Promise<void>;
  pending: boolean;
  error: string | null;
}

export function useDenyRequest(
  adminAddress: string | null,
  /** Admin's `wallets.id` (Supabase UUID). Stored on the resolved row so
   *  the dashboard can later attribute "denied by Mommy" without joining
   *  back through wallets. Pass null if unresolved; the row just records
   *  no attribution. */
  adminWalletDbId: string | null,
): UseDenyRequestResult {
  const mutation = useCallback(
    async (req: PendingSpendRequest): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("family_pending_requests")
        .update({
          status: "denied",
          resolved_at: new Date().toISOString(),
          resolved_by_wallet_id: adminWalletDbId,
        })
        .eq("id", req.id);
      if (error) throw new Error(error.message);
    },
    [adminAddress, adminWalletDbId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { deny: run, pending, error };
}
