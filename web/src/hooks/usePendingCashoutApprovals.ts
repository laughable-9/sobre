"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 2_500;

export interface PendingCashoutRequest {
  id: string;
  memberWalletId: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  amountStroops: bigint;
  memo: string;
  approversWalletIds: string[];
  createdAt: string;
}

/**
 * Multi-admin cashout approval — approver side.
 *
 * Returns every `family_pending_requests` row with `kind='cashout'`
 * and `status='pending'` where the current admin hasn't yet approved.
 * The dashboard renders these as a stack of "Approve" banners; each
 * approve action appends the current admin's wallet_id to the row's
 * `approvers_wallet_ids` and, if that completes the set, flips the
 * row to `approved` so the initiator's modal can proceed.
 *
 * Non-admins never see anything from this hook (their user isn't in
 * the admin set, so any approval they attempted would be caught by
 * RLS anyway).
 */
export function usePendingCashoutApprovals(args: {
  familyWalletId: string | null;
  currentWalletDbId: string | null;
  currentIsAdmin: boolean;
  /** Total admins in this family — needed so the client can flip
   *  status to `approved` when its own append is the last one. */
  totalAdmins: number;
}): {
  requests: PendingCashoutRequest[];
  approve: (row: PendingCashoutRequest) => Promise<void>;
  deny: (row: PendingCashoutRequest) => Promise<void>;
  refresh: () => void;
} {
  const [requests, setRequests] = useState<PendingCashoutRequest[]>([]);

  const refresh = useCallback(() => {
    const familyWalletId = args.familyWalletId;
    const currentId = args.currentWalletDbId;
    if (!familyWalletId || !currentId || !args.currentIsAdmin) {
      setRequests([]);
      return;
    }
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("family_pending_requests")
        .select(
          "id, member_wallet_id, envelope, amount_stroops, memo, approvers_wallet_ids, created_at",
        )
        .eq("family_wallet_id", familyWalletId)
        .eq("kind", "cashout")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      const rows = ((data ?? []) as Array<{
        id: string;
        member_wallet_id: string;
        envelope: "Groceries" | "Tuition" | "Savings";
        amount_stroops: string;
        memo: string;
        approvers_wallet_ids: string[] | null;
        created_at: string;
      }>)
        .filter((r) => !(r.approvers_wallet_ids ?? []).includes(currentId))
        .map((r) => ({
          id: r.id,
          memberWalletId: r.member_wallet_id,
          envelope: r.envelope,
          amountStroops: BigInt(r.amount_stroops),
          memo: r.memo ?? "",
          approversWalletIds: r.approvers_wallet_ids ?? [],
          createdAt: r.created_at,
        }));
      setRequests(rows);
    })();
  }, [args.familyWalletId, args.currentWalletDbId, args.currentIsAdmin]);

  useEffect(() => {
    // Poll-on-mount + heartbeat external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const approve = useCallback(
    async (row: PendingCashoutRequest): Promise<void> => {
      if (!args.currentWalletDbId) return;
      const supabase = getSupabaseBrowserClient();
      const nextApprovers = [
        ...row.approversWalletIds.filter((id) => id !== args.currentWalletDbId),
        args.currentWalletDbId,
      ];
      // Client-side threshold check. When this append completes the
      // admin set the row also flips to `approved` in the same update,
      // avoiding a second round-trip.
      const update: Record<string, unknown> = {
        approvers_wallet_ids: nextApprovers,
      };
      if (nextApprovers.length >= args.totalAdmins) {
        update.status = "approved";
        update.resolved_at = new Date().toISOString();
        update.resolved_by_wallet_id = args.currentWalletDbId;
      }
      await supabase
        .from("family_pending_requests")
        .update(update)
        .eq("id", row.id);
      refresh();
    },
    [args.currentWalletDbId, args.totalAdmins, refresh],
  );

  const deny = useCallback(
    async (row: PendingCashoutRequest): Promise<void> => {
      if (!args.currentWalletDbId) return;
      const supabase = getSupabaseBrowserClient();
      await supabase
        .from("family_pending_requests")
        .update({
          status: "denied",
          resolved_at: new Date().toISOString(),
          resolved_by_wallet_id: args.currentWalletDbId,
        })
        .eq("id", row.id);
      refresh();
    },
    [args.currentWalletDbId, refresh],
  );

  return { requests, approve, deny, refresh };
}
