"use client";

import { useCallback, useEffect, useState } from "react";

import { toSplit, type Split } from "@/components/sobre/SplitEditor";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { firstJoined } from "@/lib/supabase/utils";

export interface SplitProposal {
  id: string;
  /** wallets.id of the proposer, joined to the smart-wallet C-address for
   *  UI resolution against state.members. */
  proposerWalletId: string;
  proposerAddress: string | null;
  proposerName: string | null;
  proposerAvatarUrl: string | null;
  percents: Split;
  createdAt: string;
  /** Wallet IDs (family_members.wallet_id) that have voted `approve`. Any
   *  single reject flips the proposal's status to 'rejected' at the DB, so
   *  a rejecters array is intentionally not surfaced — a pending row means
   *  no rejects yet. */
  approversWalletIds: string[];
}

export interface UseSplitProposalsResult {
  /** The single live pending proposal for this family, or null. Enforced
   *  by a partial unique index on (family_wallet_id) WHERE status='pending'. */
  pending: SplitProposal | null;
  /** Derived vote state for the caller — `null` if the caller isn't an
   *  admin, hasn't voted yet, or there's no pending proposal. Callers use
   *  this to decide gear-dot / button visibility without re-deriving the
   *  approvers-array check themselves. */
  myVote: "approve" | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

interface RawProposalRow {
  id: string;
  proposed_by: string;
  percents: number[];
  created_at: string;
  wallets:
    | { contract_id: string; display_name: string | null; avatar_url: string | null }
    | { contract_id: string; display_name: string | null; avatar_url: string | null }[]
    | null;
  votes: { admin_wallet_id: string; vote: "approve" | "reject" }[] | null;
}

/**
 * Watches the family's single live pending split proposal. Postgres realtime
 * is the change source; a small initial fetch primes the state on mount.
 * (No 3s poll — the existing spend-request pattern relies on realtime alone
 * and this hook matches.)
 */
export function useSplitProposals(
  familyWalletId: string | null,
  /** Caller's wallets.id — needed to derive `myVote`. `null` while the
   *  wallet row is still loading; treat myVote as null in that window. */
  currentWalletId: string | null,
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
      // Single query: proposal + proposer join + votes. Halves round-trips
      // on every realtime tick.
      const { data: row } = await supabase
        .from("split_proposals")
        .select(
          "id, proposed_by, percents, created_at, wallets:proposed_by(contract_id, display_name, avatar_url), votes:split_proposal_votes(admin_wallet_id, vote)",
        )
        .eq("family_wallet_id", familyWalletId)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();

      if (!row) {
        setPending(null);
        return;
      }
      const p = row as unknown as RawProposalRow;
      const w = firstJoined(p.wallets);
      const approvers = (p.votes ?? [])
        .filter((v) => v.vote === "approve")
        .map((v) => v.admin_wallet_id);

      setPending({
        id: p.id,
        proposerWalletId: p.proposed_by,
        proposerAddress: w?.contract_id ?? null,
        proposerName: w?.display_name ?? null,
        proposerAvatarUrl: w?.avatar_url ?? null,
        percents: toSplit(p.percents),
        createdAt: p.created_at,
        approversWalletIds: approvers,
      });
    } finally {
      setLoading(false);
    }
  }, [familyWalletId]);

  useEffect(() => {
    // Fetch-on-mount external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Subscribe to changes on both tables. The votes filter is scoped to the
  // current pending proposal's id so unrelated vote inserts from other
  // families the user can see don't spuriously refire refresh().
  useEffect(() => {
    if (!familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`split-proposals:${familyWalletId}`);
    channel.on(
      "postgres_changes" as never,
      {
        event: "*",
        schema: "public",
        table: "split_proposals",
        filter: `family_wallet_id=eq.${familyWalletId}`,
      },
      () => void refresh(),
    );
    if (pending?.id) {
      channel.on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "split_proposal_votes",
          filter: `proposal_id=eq.${pending.id}`,
        },
        () => void refresh(),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyWalletId, refresh, pending?.id]);

  const myVote: "approve" | null =
    pending && currentWalletId && pending.approversWalletIds.includes(currentWalletId)
      ? "approve"
      : null;

  return { pending, myVote, loading, refresh };
}
