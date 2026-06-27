"use client";

import { useCallback } from "react";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
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
  const mutation = useCallback(
    async (newName: string): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("family_wallets")
        .update({ display_name: newName })
        .eq("contract_id", contractId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        throw new Error("Couldn't rename — only the family admin can change this.");
      }
    },
    [adminAddress, contractId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { renameWallet: run, pending, error };
}
