/**
 * POST /api/pdax/withdrawals/[identifier]/cancel
 *
 * Discard an in-flight cashout that never made it past the initiate
 * step. Marks the row `failed` with reason "Cancelled by user" so the
 * activity feed / sub-account view can drop it out of the PENDING
 * bucket immediately.
 *
 * Only rows where `spend_tx_hash IS NULL` and `status = 'pending'` are
 * cancellable — past that, the user's on-chain spend already landed
 * and the money is already moving toward PDAX. Trying to cancel then
 * would strand the funds; return 409 with `code: "already_spent"` so
 * the caller can bounce back to the awaiting phase instead.
 *
 * Auth is scoped to the caller's own row: we `requireFamilyParticipant`
 * on the row's family and check `member_id === ctx.memberId`. Without
 * this, any signed-in wallet with a valid identifier could nuke another
 * user's pending cashout.
 */

import { NextResponse } from "next/server";

import { requireFamilyParticipant } from "@/lib/auth/familyMember";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await ctx.params;
  if (!identifier) {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: row, error: readErr } = await admin
    .from("pdax_withdrawals")
    .select("status, spend_tx_hash, family_wallet_id, member_id")
    .eq("identifier", identifier)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { error: `Row read failed: ${readErr.message}` },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const r = row as {
    status: string;
    spend_tx_hash: string | null;
    family_wallet_id: string;
    member_id: string;
  };

  const membership = await requireFamilyParticipant(r.family_wallet_id);
  if (membership instanceof NextResponse) return membership;
  if (r.member_id !== membership.memberId) {
    return NextResponse.json({ error: "Not your cashout" }, { status: 403 });
  }

  const rate = await enforceDailyLimit({
    endpoint: "pdax_withdrawal_cancel",
    walletId: membership.memberId,
    familyWalletId: r.family_wallet_id,
    callerEmail: membership.email,
    perUser: 30,
    perFamily: 60,
  });
  if (rate) return rate;

  if (r.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot cancel a ${r.status} cashout` },
      { status: 409 },
    );
  }
  if (r.spend_tx_hash) {
    return NextResponse.json(
      {
        error: "The on-chain spend already landed; cashout can't be cancelled.",
        code: "already_spent",
      },
      { status: 409 },
    );
  }

  const { error: updErr } = await admin
    .from("pdax_withdrawals")
    .update({
      status: "failed",
      failure_reason: "Cancelled by user",
    })
    .eq("identifier", identifier)
    .eq("status", "pending")
    .is("spend_tx_hash", null);
  if (updErr) {
    return NextResponse.json(
      { error: `Cancel failed: ${updErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
