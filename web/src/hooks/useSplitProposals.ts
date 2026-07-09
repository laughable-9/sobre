"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface SplitProposal {
  id: string;
  familyWalletId: string;
  /** wallets.id of the proposer, joined to the smart-wallet C-address for
   *  UI resolution against state.members. */
  proposerWalletId: string;
  proposerAddress: string | null;
  proposerName: string | null;
  proposerAvatarUrl: string | null;
  percents: [number, number, number];
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  createdAt: string;
  expiresAt: string;
  /** Wallet IDs (family_members.wallet_id) that have voted `approve`. */
  approversWalletIds: string[];
  /** Wallet IDs that have voted `reject`. Empty by design when the
   *  proposal is still pending — one reject flips status. */
  rejectersWalletIds: string[];
}

export interface UseSplitProposalsResult {
  /** The single live pending proposal for this family, or null. Enforced
   *  by a partial unique index on (family_wallet_id) WHERE status='pending'. */
  pending: SplitProposal | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

interface RawProposalRow {
  id: string;
  family_wallet_id: string;
  proposed_by: string;
  percents: number[];
  status: SplitProposal["status"];
  created_at: string;
  expires_at: string;
  wallets: { contract_id: string; display_name: string | null; avatar_url: string | null } | null;
}

interface RawVoteRow {
  admin_wallet_id: string;
  vote: "approve" | "reject";
}

/**
 * Watches the family's single live pending split proposal. Polls every 3s
 * to match useWalletState's cadence and subscribes to Postgres changes for
 * near-instant approve/reject updates on both admins' screens.
 */
export function useSplitProposals(
  familyWalletId: string | null,
): UseSplitProposalsResult {
  const [pending, setPending] = useState<SplitProposal | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!familyWalletId) {
      setPending(null);
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: propRows } = await supabase
        .from("split_proposals")
        .select(
          "id, family_wallet_id, proposed_by, percents, status, created_at, expires_at, wallets:proposed_by(contract_id, display_name, avatar_url)",
        )
        .eq("family_wallet_id", familyWalletId)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();

      if (!propRows) {
        setPending(null);
        return;
      }
      const p = propRows as unknown as RawProposalRow;

      const { data: voteRows } = await supabase
        .from("split_proposal_votes")
        .select("admin_wallet_id, vote")
        .eq("proposal_id", p.id);

      const votes = (voteRows as RawVoteRow[] | null) ?? [];
      const approvers = votes.filter((v) => v.vote === "approve").map((v) => v.admin_wallet_id);
      const rejecters = votes.filter((v) => v.vote === "reject").map((v) => v.admin_wallet_id);

      const w = Array.isArray(p.wallets) ? p.wallets[0] ?? null : p.wallets;

      setPending({
        id: p.id,
        familyWalletId: p.family_wallet_id,
        proposerWalletId: p.proposed_by,
        proposerAddress: w?.contract_id ?? null,
        proposerName: w?.display_name ?? null,
        proposerAvatarUrl: w?.avatar_url ?? null,
        percents: normalizePercents(p.percents),
        status: p.status,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        approversWalletIds: approvers,
        rejectersWalletIds: rejecters,
      });
    } finally {
      setLoading(false);
    }
  }, [familyWalletId]);

  useEffect(() => {
    void refresh();
    if (!familyWalletId) return;
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [familyWalletId, refresh]);

  useEffect(() => {
    if (!familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`split-proposals:${familyWalletId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "split_proposals",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "split_proposal_votes" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyWalletId, refresh]);

  return { pending, loading, refresh };
}

function normalizePercents(raw: number[]): [number, number, number] {
  return [raw[0] ?? 0, raw[1] ?? 0, raw[2] ?? 0];
}
