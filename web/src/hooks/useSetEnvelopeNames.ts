"use client";

import { useCallback, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UseSetEnvelopeNamesResult {
  setEnvelopeNames: (
    familyWalletId: string,
    names: [string, string, string],
  ) => Promise<void>;
  pending: boolean;
  error: string | null;
}

const KEYS = ["Groceries", "Tuition", "Savings"] as const;

/**
 * Admin-only. Renames the three envelope display labels in Supabase
 * (family_envelope_names). Purely cosmetic — the on-chain Envelope enum
 * (`Groceries | Tuition | Savings`) still indexes balances and policy.
 * Renames are instant + free.
 */
export function useSetEnvelopeNames(
  adminAddress: string | null,
): UseSetEnvelopeNamesResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setEnvelopeNames = useCallback(
    async (
      familyWalletId: string,
      names: [string, string, string],
    ): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!familyWalletId) throw new Error("No family wallet id.");
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const rows = names.map((display_name, i) => ({
          family_wallet_id: familyWalletId,
          envelope_key: KEYS[i],
          display_name,
        }));
        const { data, error: upsertErr } = await supabase
          .from("family_envelope_names")
          .upsert(rows, { onConflict: "family_wallet_id,envelope_key" })
          .select("envelope_key");
        if (upsertErr) throw new Error(upsertErr.message);
        if (!data || data.length === 0) {
          throw new Error("Couldn't save — only the family admin can rename envelopes.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  return { setEnvelopeNames, pending, error };
}
