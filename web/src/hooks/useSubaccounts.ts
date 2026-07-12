"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface FamilySubaccountRow {
  id: string;
  familyWalletId: string;
  /** Supabase `wallets.id`. NULL while the invite is unredeemed. */
  walletDbId: string | null;
  /** Smart-wallet C-address. Denormalised onto this row at claim time so
   *  the admin panel doesn't need to JOIN through wallets (whose RLS only
   *  exposes own row and can't be widened without creating a cycle through
   *  family_members policy). */
  walletAddress: string | null;
  displayName: string;
  invitePending: boolean;
  createdAt: string;
}

export interface UseSubaccountsResult {
  subaccounts: FamilySubaccountRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface RawRow {
  id: string;
  family_wallet_id: string;
  wallet_id: string | null;
  wallet_address: string | null;
  display_name: string;
  created_at: string;
}

/**
 * Subscribe to the family's sub-account rows. Realtime channel keyed on
 * familyWalletId so a new invite or a freshly-redeemed claim appears in
 * the admin dashboard without a manual refresh. On-chain balance + lock
 * state come through `useWalletState.state.subaccounts` — components join
 * the two by wallet C-address.
 */
export function useSubaccounts(
  familyWalletId: string | null,
): UseSubaccountsResult {
  const [subaccounts, setSubaccounts] = useState<FamilySubaccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!familyWalletId) {
      setSubaccounts([]);
      return;
    }
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    try {
      const { data, error: fetchErr } = await supabase
        .from("family_subaccounts")
        .select(
          "id, family_wallet_id, wallet_id, wallet_address, display_name, created_at",
        )
        .eq("family_wallet_id", familyWalletId)
        .order("created_at", { ascending: true });
      if (fetchErr) {
        setError(`Couldn't load sub-accounts: ${fetchErr.message}`);
        return;
      }
      setError(null);
      const rows: FamilySubaccountRow[] = ((data as RawRow[] | null) ?? []).map(
        (r) => ({
          id: r.id,
          familyWalletId: r.family_wallet_id,
          walletDbId: r.wallet_id,
          walletAddress: r.wallet_address,
          displayName: r.display_name,
          invitePending: r.wallet_id === null,
          createdAt: r.created_at,
        }),
      );
      setSubaccounts(rows);
    } finally {
      setLoading(false);
    }
  }, [familyWalletId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`family-subaccounts:${familyWalletId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_subaccounts",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyWalletId, fetchAll]);

  return useMemo(
    () => ({ subaccounts, loading, error, refresh: fetchAll }),
    [subaccounts, loading, error, fetchAll],
  );
}
