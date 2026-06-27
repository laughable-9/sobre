"use client";

import { useCallback, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UseRenameWalletResult {
  renameWallet: (newName: string) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/**
 * Admin-only. Renames the wallet (the string both members see in TopBar).
 * Cosmetic — lives in Supabase only (family_wallets.display_name); never
 * touches the chain, so renames are instant + free.
 *
 * RLS gates the write so even with a stolen anon key, only the admin can
 * rename their own family.
 */
export function useRenameWallet(
  adminAddress: string | null,
  contractId: string | null,
): UseRenameWalletResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renameWallet = useCallback(
    async (newName: string): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { error: updateErr } = await supabase
          .from("family_wallets")
          .update({ display_name: newName })
          .eq("contract_id", contractId);
        if (updateErr) throw new Error(updateErr.message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress, contractId],
  );

  return { renameWallet, pending, error };
}
