"use client";

import { useCallback, useEffect, useState } from "react";

import type { EnvelopeName } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface PendingSpendRequest {
  id: string;
  memberWalletId: string;
  /** Member's smart wallet C-address. Resolved via join on `wallets`. */
  memberAddress: string;
  envelope: EnvelopeName;
  amountStroops: bigint;
  memo: string;
  createdAt: string;
}

export interface UsePendingSpendRequestsResult {
  pending: PendingSpendRequest[];
  loading: boolean;
  refresh: () => Promise<void>;
}

interface RawRow {
  id: string;
  family_wallet_id: string;
  member_wallet_id: string;
  envelope: EnvelopeName;
  amount_stroops: string | number;
  memo: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
  wallets: { contract_id: string } | { contract_id: string }[] | null;
}

function normalize(row: RawRow): PendingSpendRequest | null {
  const wallets = Array.isArray(row.wallets) ? row.wallets[0] : row.wallets;
  if (!wallets?.contract_id) return null;
  return {
    id: row.id,
    memberWalletId: row.member_wallet_id,
    memberAddress: wallets.contract_id,
    envelope: row.envelope,
    amountStroops: BigInt(row.amount_stroops),
    memo: row.memo ?? "",
    createdAt: row.created_at,
  };
}

/**
 * Off-chain replacement for the contract's on-chain pending_requests queue.
 * Members create rows when their spend would exceed the family policy;
 * admin resolves them via approve (chain spend_on_behalf) or deny
 * (Supabase-only status flip).
 */
export function usePendingSpendRequests(
  familyWalletId: string | null,
): UsePendingSpendRequestsResult {
  const [pending, setPending] = useState<PendingSpendRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!familyWalletId) {
      setPending([]);
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("family_pending_requests")
        .select(
          "id, family_wallet_id, member_wallet_id, envelope, amount_stroops, memo, status, created_at, wallets(contract_id)",
        )
        .eq("family_wallet_id", familyWalletId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      const rows = (data as RawRow[] | null) ?? [];
      setPending(rows.map(normalize).filter((r): r is PendingSpendRequest => r !== null));
    } finally {
      setLoading(false);
    }
  }, [familyWalletId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`pending-spend-requests:${familyWalletId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_pending_requests",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyWalletId, refresh]);

  return { pending, loading, refresh };
}
