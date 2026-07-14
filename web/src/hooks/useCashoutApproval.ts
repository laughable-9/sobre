"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EnvelopeName } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Poll cadence for the request row while the modal sits in the
 *  `awaiting_approval` phase. Realtime would be nicer but a 2s poll
 *  keeps the code straightforward for the demo and stays well under
 *  the Supabase rate limits. */
const POLL_INTERVAL_MS = 2_000;

export type CashoutApprovalStatus =
  | "idle"
  | "creating"
  | "pending"
  | "approved"
  | "denied";

export interface CashoutApprovalState {
  status: CashoutApprovalStatus;
  requestId: string | null;
  /** Wallet ids of every admin who has recorded an approval so far,
   *  including the initiator. `useCashoutApproval` seeds this with
   *  the initiator's own id when the row is created. */
  approvers: string[];
  error: string | null;
  create: (args: { memo?: string }) => Promise<string | null>;
  /** Initiator-side cancel. Flips the row to `denied` so other admins
   *  stop seeing it in their approval banner. */
  cancel: () => Promise<void>;
  /** Reset back to idle without touching the DB — used after a
   *  successful cashout so the modal is ready for the next attempt. */
  reset: () => void;
}

/**
 * Multi-admin approval — initiator side.
 *
 * Creates a `family_pending_requests` row (kind = cashout OR
 * subaccount_fund) and seeds `approvers_wallet_ids` with the
 * initiator's own id (auto-appended by the INSERT RLS policy). Polls
 * the row every 2s; the returned `status` reflects the DB state, and
 * consumers should fire the on-chain op when it flips to `approved`.
 *
 * Solo-admin families should bypass this hook entirely — the sole
 * admin's action IS the approval, so wiring them through here would
 * just add a synthetic "waiting for 0 more admins" step.
 */
export function useCashoutApproval(args: {
  familyWalletId: string | null;
  memberWalletDbId: string | null;
  envelope: EnvelopeName;
  amountStroops: bigint;
  /** Which op the request will authorize. Defaults to `cashout` for
   *  back-compat with the PDAX withdraw modal. */
  kind?: "cashout" | "subaccount_fund";
  /** Sub-account recipient's smart-wallet C-address. Required when
   *  kind='subaccount_fund' — the RLS INSERT policy pins the row's
   *  recipient_address to a claimed family_subaccounts row. */
  recipientAddress?: string | null;
}): CashoutApprovalState {
  const [status, setStatus] = useState<CashoutApprovalStatus>("idle");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Mirror requestId into a ref so the cancel() closure (memoized
  // with no deps) always reads the latest id. Written inside an
  // effect to satisfy React's no-ref-writes-during-render rule.
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = requestId;
  }, [requestId]);

  const create = useCallback(
    async ({ memo = "" }: { memo?: string } = {}): Promise<string | null> => {
      if (!args.familyWalletId || !args.memberWalletDbId) return null;
      setError(null);
      setStatus("creating");
      try {
        const supabase = getSupabaseBrowserClient();
        const kind = args.kind ?? "cashout";
        const insertRow: Record<string, unknown> = {
          family_wallet_id: args.familyWalletId,
          member_wallet_id: args.memberWalletDbId,
          envelope: args.envelope,
          amount_stroops: args.amountStroops.toString(),
          approval_mode: "all_admins",
          kind,
          memo,
          // Initiator's wallet_id auto-counts as the first approval;
          // the RLS INSERT policy requires this exact shape.
          approvers_wallet_ids: [args.memberWalletDbId],
        };
        if (kind === "subaccount_fund") {
          if (!args.recipientAddress) {
            throw new Error(
              "Recipient sub-account address is required for a subaccount_fund request.",
            );
          }
          insertRow.recipient_address = args.recipientAddress;
        }
        const { data, error: insertErr } = await supabase
          .from("family_pending_requests")
          .insert(insertRow)
          .select("id, status, approvers_wallet_ids")
          .single();
        if (insertErr) throw new Error(insertErr.message);
        const row = data as {
          id: string;
          status: string;
          approvers_wallet_ids: string[];
        };
        setRequestId(row.id);
        setApprovers(row.approvers_wallet_ids ?? []);
        setStatus(
          row.status === "approved"
            ? "approved"
            : row.status === "denied"
              ? "denied"
              : "pending",
        );
        return row.id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus("idle");
        return null;
      }
    },
    [
      args.familyWalletId,
      args.memberWalletDbId,
      args.envelope,
      args.amountStroops,
      args.kind,
      args.recipientAddress,
    ],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase
        .from("family_pending_requests")
        .update({ status: "denied", resolved_at: new Date().toISOString() })
        .eq("id", id);
      setStatus("denied");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setRequestId(null);
    setApprovers([]);
    setError(null);
  }, []);

  // Poll the row while it's pending. Stops on approved/denied so a
  // finished request doesn't keep hitting Supabase for the demo's
  // duration.
  useEffect(() => {
    if (!requestId) return;
    if (status !== "pending") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase
          .from("family_pending_requests")
          .select("status, approvers_wallet_ids")
          .eq("id", requestId)
          .maybeSingle();
        if (cancelled || !data) return;
        const row = data as {
          status: string;
          approvers_wallet_ids: string[];
        };
        setApprovers(row.approvers_wallet_ids ?? []);
        if (row.status === "approved") setStatus("approved");
        else if (row.status === "denied") setStatus("denied");
      } catch {
        // Transient network — next tick tries again.
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [requestId, status]);

  return {
    status,
    requestId,
    approvers,
    error,
    create,
    cancel,
    reset,
  };
}
