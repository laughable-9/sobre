"use client";

import { useCallback } from "react";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { ENVELOPE_LABELS } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UseSetEnvelopeNamesResult {
  setEnvelopeNames: (
    familyWalletId: string,
    names: [string, string, string],
  ) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/**
 * Admin-only. Renames the three envelope display labels in Supabase
 * (family_envelope_names). Purely cosmetic — the canonical Envelope enum
 * (`Groceries | Tuition | Savings`) still indexes balances and policy.
 * Renames are instant + free.
 */
export function useSetEnvelopeNames(
  adminAddress: string | null,
): UseSetEnvelopeNamesResult {
  const mutation = useCallback(
    async (
      familyWalletId: string,
      names: [string, string, string],
    ): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!familyWalletId) throw new Error("No family wallet id.");
      const supabase = getSupabaseBrowserClient();
      const rows = names.map((display_name, i) => ({
        family_wallet_id: familyWalletId,
        envelope_key: ENVELOPE_LABELS[i],
        display_name,
      }));
      const { data, error } = await supabase
        .from("family_envelope_names")
        .upsert(rows, { onConflict: "family_wallet_id,envelope_key" })
        .select("envelope_key");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("Couldn't save — only the family admin can rename envelopes.");
      }
    },
    [adminAddress],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { setEnvelopeNames: run, pending, error };
}
