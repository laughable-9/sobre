"use client";

import { useCallback } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { envelopeScVal, invokeWrite } from "@/lib/contract";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PendingSpendRequest } from "@/hooks/usePendingSpendRequests";

export interface ApproveOutcome {
  /** "released" → spend signed on chain and row flipped to approved.
   *  "approved_waiting" → approval recorded but more admins still need to
   *  approve (Savings lock, all_admins mode). */
  status: "released" | "approved_waiting";
  /** Chain tx hash. Only set when status === "released". */
  hash?: string;
  adminApprovalCount?: number;
  adminCount?: number;
}

export interface UseApproveRequestResult {
  /** Approves an off-chain pending request. Always records the admin's
   *  approval through the relay route; the route decides whether enough
   *  admins have signed to release. If yes, the hook signs the chain call
   *  (`spend_on_behalf` for member spends; `fund_subaccount` for sub-account
   *  top-ups) and flips the Supabase row to status=approved. The Realtime
   *  subscription on `family_pending_requests` removes it from the panel. */
  approve: (req: PendingSpendRequest) => Promise<ApproveOutcome>;
  pending: boolean;
  error: string | null;
}

export function useApproveRequest(
  adminAddress: string | null,
  contractId: string | null,
  /** Admin's `wallets.id` (Supabase UUID). Stored alongside the row so the
   *  dashboard can later attribute "approved by Daddy" without re-joining. */
  adminWalletDbId: string | null,
): UseApproveRequestResult {
  const mutation = useCallback(
    async (req: PendingSpendRequest): Promise<ApproveOutcome> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");

      // Relay route records the admin's approval, re-counts against the
      // family's LIVE admin count, and decides whether the row can release.
      // 200 → row already claimed `releasing` server-side; we sign + flip
      //       to `approved` (or revert to `pending` on chain failure).
      // 409 → approval recorded, still waiting on more admins.
      let res: Response;
      try {
        res = await fetch(`/api/spend-requests/${req.id}/release`, {
          method: "POST",
        });
      } catch (e) {
        throw new Error(
          `Couldn't reach the approval service. Check your connection and try again. (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      }
      let payload:
        | {
            error: string;
            adminApprovalCount?: number;
            adminCount?: number;
            approvalMode?: "single_admin" | "all_admins";
          }
        | {
            id: string;
            envelope: "Groceries" | "Tuition" | "Savings";
            amountStroops: string;
            memo: string;
            kind: "member_spend" | "subaccount_fund";
            memberAddress: string;
            recipientAddress: string | null;
            adminApprovalCount: number;
            adminCount: number;
            approvalMode: "single_admin" | "all_admins";
          };
      try {
        payload = await res.json();
      } catch {
        throw new Error(
          `Approval service returned an unexpected response (HTTP ${res.status}). Refresh and try again.`,
        );
      }

      if (res.status === 409 && "error" in payload && payload.error === "more_admins_needed") {
        return {
          status: "approved_waiting",
          adminApprovalCount: payload.adminApprovalCount,
          adminCount: payload.adminCount,
        };
      }
      if (!res.ok || "error" in payload) {
        const msg =
          "error" in payload && payload.error ? payload.error : `Release check failed (${res.status})`;
        throw new Error(msg);
      }

      // Row is now `releasing` server-side. From here, every failure
      // path MUST revert the row to `pending` so another admin can
      // retry; otherwise the row is stuck and admins must intervene
      // manually.
      const supabase = getSupabaseBrowserClient();
      const revertToPending = async () => {
        await supabase
          .from("family_pending_requests")
          .update({ status: "pending" })
          .eq("id", req.id)
          .eq("status", "releasing");
      };

      let hash: string;
      try {
        if (payload.kind === "subaccount_fund") {
          if (!payload.recipientAddress) {
            throw new Error("Sub-account funding request is missing its recipient.");
          }
          const args = [
            envelopeScVal(payload.envelope),
            Address.fromString(payload.recipientAddress).toScVal(),
            nativeToScVal(BigInt(payload.amountStroops), { type: "i128" }),
          ];
          ({ hash } = await invokeWrite(contractId, "fund_subaccount", args));
        } else {
          const args = [
            Address.fromString(payload.memberAddress).toScVal(),
            envelopeScVal(payload.envelope),
            nativeToScVal(BigInt(payload.amountStroops), { type: "i128" }),
            nativeToScVal(payload.memo, { type: "string" }),
          ];
          ({ hash } = await invokeWrite(contractId, "spend_on_behalf", args));
        }
      } catch (chainErr) {
        await revertToPending();
        throw chainErr;
      }

      // Mark resolved after the chain call lands. Status moves from
      // `releasing` to `approved`; if this update fails the row stays
      // `releasing` (NOT `pending`) so we don't re-trigger the chain
      // call on a successful spend. Surfaced to the admin so they
      // know to refresh.
      const { error: updateErr } = await supabase
        .from("family_pending_requests")
        .update({
          status: "approved",
          resolved_at: new Date().toISOString(),
          resolved_by_wallet_id: adminWalletDbId,
          executed_spend_tx_hash: hash,
        })
        .eq("id", req.id);
      if (updateErr) {
        throw new Error(
          `Release succeeded on chain but the request status couldn't be updated (${updateErr.message}). Refresh before retrying so you don't approve twice.`,
        );
      }

      return {
        status: "released",
        hash,
        adminApprovalCount: payload.adminApprovalCount,
        adminCount: payload.adminCount,
      };
    },
    [adminAddress, contractId, adminWalletDbId],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { approve: run, pending, error };
}
