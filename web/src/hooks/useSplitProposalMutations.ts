"use client";

import { useCallback, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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
 * Thin wrappers around the three split-proposal RPCs. Keeping the mutation
 * hooks small mirrors the useApproveRequest / useDenyRequest split that
 * already exists for spend approvals.
 */
export function useProposeSplit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propose = useCallback(
    async (
      familyWalletId: string,
      percents: [number, number, number],
    ): Promise<ProposeOutcome> => {
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: rpcErr } = await supabase.rpc("create_split_proposal", {
          p_family_wallet_id: familyWalletId,
          p_percents: percents,
        });
        if (rpcErr) throw rpcErr;
        return data as ProposeOutcome;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { propose, pending, error };
}

export function useVoteSplitProposal() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vote = useCallback(
    async (
      proposalId: string,
      choice: "approve" | "reject",
    ): Promise<VoteOutcome> => {
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: rpcErr } = await supabase.rpc(
          "record_split_vote_and_maybe_apply",
          { p_proposal_id: proposalId, p_vote: choice },
        );
        if (rpcErr) throw rpcErr;
        return data as VoteOutcome;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { vote, pending, error };
}

export function useCancelSplitProposal() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(
    async (proposalId: string): Promise<CancelOutcome> => {
      setPending(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: rpcErr } = await supabase.rpc(
          "cancel_split_proposal",
          { p_proposal_id: proposalId },
        );
        if (rpcErr) throw rpcErr;
        return data as CancelOutcome;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { cancel, pending, error };
}
