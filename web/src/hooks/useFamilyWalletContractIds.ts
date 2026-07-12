"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * All family_wallets contract_ids the current session can SELECT — i.e.
 * every Sobre this user is the on-chain admin of (per the RLS "family_wallets
 * select by creator" policy). The /dashboard "My Sobres" list intersects
 * this with the on-chain `sobres_of_admin` list to hide orphan chain
 * contracts whose Supabase mirror never landed.
 */
export function useFamilyWalletContractIds(): {
  contractIds: Set<string> | null;
  loading: boolean;
  error: string | null;
} {
  const [contractIds, setContractIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: err } = await supabase
          .from("family_wallets")
          .select("contract_id");
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        const rows = (data as { contract_id: string }[] | null) ?? [];
        setContractIds(new Set(rows.map((r) => r.contract_id)));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { contractIds, loading, error };
}
