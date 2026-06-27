"use client";

import { useCallback, useState } from "react";

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
): UseDenyRequestResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deny = useCallback(
    async (req: PendingSpendRequest): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: adminWalletRow } = await supabase
          .from("wallets")
          .select("id")
          .eq("contract_id", adminAddress)
          .single();
        const { error: updateErr } = await supabase
          .from("family_pending_requests")
          .update({
            status: "denied",
            resolved_at: new Date().toISOString(),
            resolved_by_wallet_id:
              (adminWalletRow as { id: string } | null)?.id ?? null,
          })
          .eq("id", req.id);
        if (updateErr) throw new Error(updateErr.message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  return { deny, pending, error };
}
