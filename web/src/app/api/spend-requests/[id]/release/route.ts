/**
 * POST /api/spend-requests/[id]/release
 *
 * Server-side guard that runs before the admin's client signs
 * `spend_on_behalf` (or `fund_subaccount` for a sub-account top-up request)
 * to release a pending row. Two responsibilities:
 *
 *   1. Record the caller's approval. Appended to `approvers_wallet_ids`,
 *      idempotent — re-clicks don't double-count.
 *   2. Decide whether the row can release yet. For `single_admin` the first
 *      admin approval is enough. For `all_admins` (the Savings lock) we
 *      re-read the family's admin count LIVE from `family_members` and
 *      require approvals_by_admins >= admin_count. The live count means a
 *      newly-joined admin re-thresholds in-flight requests.
 *
 * The route does not sign or submit anything on chain — the smart-wallet
 * passkey is browser-side and the contract's auth requires the on-chain
 * admin to sign. We return a 200 verdict + the row payload so the client
 * can invoke the correct method (`spend_on_behalf` vs `fund_subaccount`).
 * A 409 means "approval recorded, still waiting on more admins" — not an
 * error; the panel just stays.
 */

import { NextResponse } from "next/server";

import { requireFamilyAdmin } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ReleasableRow = {
  id: string;
  family_wallet_id: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  amount_stroops: string;
  memo: string;
  status: "pending" | "approved" | "denied";
  approval_mode: "single_admin" | "all_admins";
  kind: "member_spend" | "subaccount_fund";
  recipient_address: string | null;
  approvers_wallet_ids: string[] | null;
  wallets: { contract_id: string } | { contract_id: string }[] | null;
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

  // Read the row with the admin client first so we can identify the family
  // it belongs to; the actual admin-membership check is delegated to
  // `requireFamilyAdmin` below.
  const { data: rowData, error: readErr } = await admin
    .from("family_pending_requests")
    .select(
      "id, family_wallet_id, envelope, amount_stroops, memo, status, approval_mode, kind, recipient_address, approvers_wallet_ids, wallets:member_wallet_id(contract_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!rowData) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  const row = rowData as ReleasableRow;
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `Request is already ${row.status}.` },
      { status: 409 },
    );
  }

  // Single source of truth for "is signed-in caller an admin of this
  // family": shared with every other admin-only mutating route.
  const auth = await requireFamilyAdmin(row.family_wallet_id);
  if (auth instanceof NextResponse) return auth;

  // Append the caller's approval — idempotent. Using array_append + a
  // re-read keeps duplicates out at the read layer; the relay re-counts
  // distinct admin ids anyway.
  const existing = row.approvers_wallet_ids ?? [];
  const nextApprovers = existing.includes(auth.memberId)
    ? existing
    : [...existing, auth.memberId];
  if (nextApprovers !== existing) {
    const { error: updErr } = await admin
      .from("family_pending_requests")
      .update({ approvers_wallet_ids: nextApprovers })
      .eq("id", id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  // Count how many of the row's approvers are CURRENTLY admins of the
  // family. Approvers who lose their admin role lose their approval; new
  // admins haven't approved by default.
  const { data: adminRows, error: adminErr } = await admin
    .from("family_members")
    .select("wallet_id")
    .eq("family_wallet_id", row.family_wallet_id)
    .eq("role", "admin");
  if (adminErr) {
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }
  const adminIds = new Set(
    (adminRows as { wallet_id: string }[] | null)?.map((r) => r.wallet_id) ??
      [],
  );
  const adminCount = adminIds.size;
  const adminApprovers = nextApprovers.filter((wid) => adminIds.has(wid));
  const adminApprovalCount = adminApprovers.length;

  // `all_admins` mode = Savings lock. Every current admin must have an
  // approval recorded. Re-counted fresh so admin churn re-thresholds the
  // row mid-flight.
  if (row.approval_mode === "all_admins") {
    if (adminApprovalCount < adminCount) {
      return NextResponse.json(
        {
          error: "more_admins_needed",
          adminApprovalCount,
          adminCount,
        },
        { status: 409 },
      );
    }
  }

  // Originator's address (for spend_on_behalf, the `member` arg). RLS-free
  // join above guarantees this; defensive null check anyway.
  const wallets = Array.isArray(row.wallets) ? row.wallets[0] : row.wallets;
  const memberAddress = wallets?.contract_id ?? null;
  if (!memberAddress) {
    return NextResponse.json(
      { error: "Originator wallet record missing." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: row.id,
    envelope: row.envelope,
    amountStroops: row.amount_stroops,
    memo: row.memo,
    kind: row.kind,
    memberAddress,
    recipientAddress: row.recipient_address,
    adminApprovalCount,
    adminCount,
  });
}
