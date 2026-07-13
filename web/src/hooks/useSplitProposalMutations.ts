"use client";

import { useCallback } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";

type ProposeOutcome =
  | { outcome: "created"; id: string }
  | { outcome: "pending_exists" }
  | { outcome: "not_admin" }
  | { outcome: "not_authenticated" };

type VoteOutcome =
  | { outcome: "approved"; percents: number[] }
  | { outcome: "rejected" }
  | { outcome: "more_admins_needed"; approval_count: number; admin_count: number }
  | { outcome: "already_resolved"; status: string }
  | { outcome: "expired" }
  | { outcome: "not_admin" }
  | { outcome: "not_authenticated" }
  | { outcome: "not_found" }
  | { outcome: "bad_vote" };

type CancelOutcome =
  | { outcome: "cancelled" }
  | { outcome: "not_proposer" }
  | { outcome: "already_resolved"; status: string }
  | { outcome: "not_found" }
  | { outcome: "not_authenticated" };

/**
 * Thin wrappers around the three split-proposal RPCs. Each hook uses the
 * shared {@link useSupabaseMutation} scaffold so pending/error handling
 * lives in one place — matches how spend-request writes are built.
 */
export function useProposeSplit() {
  const call = useCallback(
    async (
      familyWalletId: string,
      percents: [number, number, number],
    ): Promise<ProposeOutcome> => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("create_split_proposal", {
        p_family_wallet_id: familyWalletId,
        p_percents: percents,
      });
      if (error) throw error;
      return data as ProposeOutcome;
    },
    [],
  );
  const { run: propose, pending, error } = useSupabaseMutation(call);
  return { propose, pending, error };
}

export function useVoteSplitProposal() {
  const call = useCallback(
    async (
      proposalId: string,
      choice: "approve" | "reject",
    ): Promise<VoteOutcome> => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc(
        "record_split_vote_and_maybe_apply",
        { p_proposal_id: proposalId, p_vote: choice },
      );
      if (error) throw error;
      return data as VoteOutcome;
    },
    [],
  );
  const { run: vote, pending, error } = useSupabaseMutation(call);
  return { vote, pending, error };
}

export function useCancelSplitProposal() {
  const call = useCallback(
    async (proposalId: string): Promise<CancelOutcome> => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("cancel_split_proposal", {
        p_proposal_id: proposalId,
      });
      if (error) throw error;
      return data as CancelOutcome;
    },
    [],
  );
  const { run: cancel, pending, error } = useSupabaseMutation(call);
  return { cancel, pending, error };
}
