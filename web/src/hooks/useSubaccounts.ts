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
  /** Google profile picture. Prefers family_subaccounts.avatar_url when
   *  set, falls back to wallets.avatar_url so a sub-account signed in with
   *  Google shows their Gmail avatar in the activity feed. */
  avatarUrl: string | null;
  invitePending: boolean;
  /** sha256 hex of the plaintext invite token. Populated on `create_
   *  subaccount_invite` and needed by `cancel_subaccount_invite` to look
   *  up the on-chain storage entry. Null on rows redeemed before the
   *  column existed. */
  inviteTokenHash: string | null;
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
  avatar_url: string | null;
  invite_token_hash: string | null;
  created_at: string;
  wallets:
    | { avatar_url: string | null }
    | Array<{ avatar_url: string | null }>
    | null;
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
          "id, family_wallet_id, wallet_id, wallet_address, display_name, avatar_url, invite_token_hash, created_at, wallets(avatar_url)",
        )
        .eq("family_wallet_id", familyWalletId)
        .order("created_at", { ascending: true });
      if (fetchErr) {
        setError(`Couldn't load sub-accounts: ${fetchErr.message}`);
        return;
      }
      setError(null);
      const rows: FamilySubaccountRow[] = ((data as RawRow[] | null) ?? []).map(
        (r) => {
          const walletsRow = Array.isArray(r.wallets) ? r.wallets[0] : r.wallets;
          return {
            id: r.id,
            familyWalletId: r.family_wallet_id,
            walletDbId: r.wallet_id,
            walletAddress: r.wallet_address,
            displayName: r.display_name,
            avatarUrl: r.avatar_url ?? walletsRow?.avatar_url ?? null,
            invitePending: r.wallet_id === null,
            inviteTokenHash: r.invite_token_hash,
            createdAt: r.created_at,
          };
        },
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
    // Supabase caches channels by name; two hook instances subscribing
    // to the same familyWalletId (e.g. SubAccountsPanel + SubAccountView)
    // would collide and the second `.on()` would throw "cannot add
    // postgres_changes callbacks after subscribe()". Add a per-instance
    // suffix so each hook gets its own channel.
    const suffix =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`family-subaccounts:${familyWalletId}:${suffix}`)
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
