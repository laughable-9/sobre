"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface TransferDestination {
  contractId: string;
  displayName: string;
}

/**
 * Every other Sobre the current user can transfer money to. Reads
 * `family_wallets` under the caller's session — RLS gates the SELECT
 * to families the user is an admin or member of, so the returned
 * list is exactly "Sobres this user can act on". The current Sobre
 * is filtered out (transferring to yourself doesn't make sense).
 *
 * Uses lightweight polling (5s) so a newly-created Sobre appears in
 * the picker without a page reload.
 */
export function useTransferDestinations(
  currentContractId: string | null,
): { destinations: TransferDestination[]; loading: boolean } {
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("family_wallets")
        .select("contract_id, display_name")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const rows = (data as { contract_id: string; display_name: string | null }[] | null) ?? [];
      setDestinations(
        rows
          .filter((r) => r.contract_id !== currentContractId)
          .map((r) => ({
            contractId: r.contract_id,
            displayName: r.display_name ?? "Family Wallet",
          })),
      );
      setLoading(false);
    };
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentContractId]);

  return { destinations, loading };
}
