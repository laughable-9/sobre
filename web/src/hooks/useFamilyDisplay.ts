"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface FamilyMemberDisplay {
  /** Smart-wallet C-address. Matches the on-chain Member.address. */
  contractId: string;
  /** Supabase public.wallets.id, exposed for components that need to write
   *  back to the same row (own profile edit). */
  walletDbId: string;
  name: string;
  emoji: string;
  role: "admin" | "recipient";
}

export interface FamilyDisplayState {
  /** family_wallets.id (the Supabase UUID). null while resolving. */
  familyWalletId: string | null;
  /** family_wallets.display_name. */
  walletName: string;
  /** Ordered [Groceries, Tuition, Savings] display labels. Falls back to
   *  the canonical keys if a row is missing for any reason. */
  envelopeNames: [string, string, string];
  /** Members keyed by their on-chain C-address so callers joining against
   *  WalletState.members can lookup display by `members.address`. */
  membersByAddress: Map<string, FamilyMemberDisplay>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_NAMES: [string, string, string] = [
  "Groceries",
  "Tuition",
  "Savings",
];

/**
 * Subscribes to the Supabase-resident cosmetic state for a family wallet:
 * wallet display name, the three envelope display labels, and per-member
 * display name + emoji. The on-chain WalletState carries only addresses
 * and percentages; this hook covers everything UI-only.
 *
 * Realtime subscriptions on all three tables keep the UI in sync without
 * polling. Callers join against on-chain members by C-address via
 * `membersByAddress`.
 */
export function useFamilyDisplay(
  contractId: string | null,
): FamilyDisplayState {
  const [familyWalletId, setFamilyWalletId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [envelopeNames, setEnvelopeNames] =
    useState<[string, string, string]>(DEFAULT_NAMES);
  const [membersByAddress, setMembersByAddress] = useState<
    Map<string, FamilyMemberDisplay>
  >(new Map());
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    try {
      const { data: family } = await supabase
        .from("family_wallets")
        .select("id, display_name")
        .eq("contract_id", contractId)
        .maybeSingle();
      if (!family) {
        setFamilyWalletId(null);
        setWalletName("");
        setEnvelopeNames(DEFAULT_NAMES);
        setMembersByAddress(new Map());
        return;
      }
      const fid = (family as { id: string }).id;
      setFamilyWalletId(fid);
      setWalletName((family as { display_name: string | null }).display_name ?? "");

      const [{ data: names }, { data: members }] = await Promise.all([
        supabase
          .from("family_envelope_names")
          .select("envelope_key, display_name")
          .eq("family_wallet_id", fid),
        supabase
          .from("family_members")
          .select(
            "wallet_id, role, name, emoji, wallets(contract_id)",
          )
          .eq("family_wallet_id", fid),
      ]);

      const nextNames: [string, string, string] = [...DEFAULT_NAMES];
      for (const row of (names as Array<{ envelope_key: string; display_name: string }> | null) ??
        []) {
        if (row.envelope_key === "Groceries") nextNames[0] = row.display_name;
        else if (row.envelope_key === "Tuition") nextNames[1] = row.display_name;
        else if (row.envelope_key === "Savings") nextNames[2] = row.display_name;
      }
      setEnvelopeNames(nextNames);

      const map = new Map<string, FamilyMemberDisplay>();
      type MemberRow = {
        wallet_id: string;
        role: "admin" | "recipient";
        name: string | null;
        emoji: string | null;
        wallets: { contract_id: string } | { contract_id: string }[] | null;
      };
      for (const row of (members as MemberRow[] | null) ?? []) {
        const wallets = Array.isArray(row.wallets) ? row.wallets[0] : row.wallets;
        if (!wallets?.contract_id) continue;
        map.set(wallets.contract_id, {
          contractId: wallets.contract_id,
          walletDbId: row.wallet_id,
          name: row.name ?? "",
          emoji: row.emoji ?? "",
          role: row.role,
        });
      }
      setMembersByAddress(map);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Realtime: any change to the three tables, scoped to this family,
  // re-fetches. Coarse but cheap since each table is tiny.
  useEffect(() => {
    if (!contractId || !familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`family-display:${familyWalletId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_wallets",
          filter: `id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_envelope_names",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [contractId, familyWalletId, fetchAll]);

  return {
    familyWalletId,
    walletName,
    envelopeNames,
    membersByAddress,
    loading,
    refresh: fetchAll,
  };
}
