/**
 * POST /api/spend-requests/[id]/release
 *
 * Server-side gate that the admin's client hits before signing
 * spend_on_behalf (or fund_subaccount, for a sub-account top-up request).
 * Three responsibilities, all delegated to the
 * record_approval_and_maybe_claim_release RPC so the work happens under
 * a single row lock:
 *
 *   1. Verify caller is a current admin of the row's family.
 *   2. Record the caller's approval idempotently (array_append, no
 *      lost-update race).
 *   3. Re-derive the effective approval mode (single_admin vs
 *      all_admins) from family_wallets.savings_lock_all_admins +
 *      envelope + LIVE admin count, ignoring the row's stored value.
 *      Without this re-derive a member could tamper with the column at
 *      INSERT and defeat the Savings lock.
 *   4. If threshold met, atomically claim by flipping the row's status
 *      from 'pending' to 'releasing'. Two admins clicking
 *      simultaneously past the threshold cannot both win the claim, so
 *      the contract's single-signature spend_on_behalf can't fire
 *      twice. On chain failure the client reverts the row back to
 *      'pending' (see useApproveRequest).
 *
 * The route does not sign or submit anything on chain. The smart-wallet
 * passkey is browser-side. The 200 payload carries the row's envelope,
 * amount, memo, kind, member, and recipient so the client signs from
 * a server-verified snapshot rather than its cached row.
 */

import { NextResponse } from "next/server";

import { requireFamilyAdmin } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RpcOutcome =
  | { outcome: "not_found" }
  | { outcome: "already_resolved"; status: string }
  | { outcome: "not_admin" }
  | { outcome: "race_lost" }
  | {
      outcome: "more_admins_needed";
      admin_approval_count: number;
      admin_count: number;
      approval_mode: "single_admin" | "all_admins";
    }
  | {
      outcome: "release";
      envelope: "Groceries" | "Tuition" | "Savings";
      amount_stroops: string;
      memo: string;
      kind: "member_spend" | "subaccount_fund";
      recipient_address: string | null;
      member_wallet_id: string;
      admin_approval_count: number;
      admin_count: number;
      approval_mode: "single_admin" | "all_admins";
    };

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing request id" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Pre-flight read just to identify the family for the auth check. The
  // RPC re-locks under SELECT FOR UPDATE and re-validates everything, so
  // a row change between this read and the RPC is harmless.
  const { data: row, error: readErr } = await admin
    .from("family_pending_requests")
    .select("family_wallet_id, member_wallet_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const auth = await requireFamilyAdmin(
    (row as { family_wallet_id: string }).family_wallet_id,
  );
  if (auth instanceof NextResponse) return auth;

  // RPC does the record-approval + count + claim-flip atomically. The
  // approval is appended idempotently even when the outcome is
  // more_admins_needed, so re-clicks don't double-count and admins can
  // record approval ahead of others.
  const { data: rpcData, error: rpcErr } = await admin.rpc(
    "record_approval_and_maybe_claim_release",
    { p_request_id: id, p_caller_wallet_id: auth.memberId },
  );
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  const result = rpcData as RpcOutcome;

  // Wallet contract address for the originator. Looked up after the RPC
  // claim succeeds so a client tampering with the row's member_wallet_id
  // points at someone, but spend_on_behalf still resolves the address
  // from this server-side join.
  const lookupMember = async (walletId: string) => {
    const { data } = await admin
      .from("wallets")
      .select("contract_id")
      .eq("id", walletId)
      .maybeSingle();
    return (data as { contract_id: string } | null)?.contract_id ?? null;
  };

  switch (result.outcome) {
    case "not_found":
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    case "not_admin":
      return NextResponse.json(
        { error: "Only family admins can release spend requests." },
        { status: 403 },
      );
    case "already_resolved":
      return NextResponse.json(
        { error: `Request is already ${result.status}.` },
        { status: 409 },
      );
    case "race_lost":
      return NextResponse.json(
        { error: "Another admin is releasing this request right now." },
        { status: 409 },
      );
    case "more_admins_needed":
      return NextResponse.json(
        {
          error: "more_admins_needed",
          adminApprovalCount: result.admin_approval_count,
          adminCount: result.admin_count,
          approvalMode: result.approval_mode,
        },
        { status: 409 },
      );
    case "release": {
      const memberAddress = await lookupMember(result.member_wallet_id);
      if (!memberAddress) {
        // Roll the claim back so the next admin can retry.
        await admin
          .from("family_pending_requests")
          .update({ status: "pending" })
          .eq("id", id)
          .eq("status", "releasing");
        return NextResponse.json(
          { error: "Originator wallet record missing." },
          { status: 500 },
        );
      }
      return NextResponse.json({
        id,
        envelope: result.envelope,
        amountStroops: result.amount_stroops,
        memo: result.memo,
        kind: result.kind,
        memberAddress,
        recipientAddress: result.recipient_address,
        adminApprovalCount: result.admin_approval_count,
        adminCount: result.admin_count,
        approvalMode: result.approval_mode,
      });
    }
  }
}
