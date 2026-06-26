/**
 * POST /api/pdax/deposits/[identifier]/cancel
 *
 * Marks an in-flight deposit row as `failed` with a "Cancelled by user"
 * reason. Used by the activity feed's "Discard" affordance so users can
 * clear out abandoned deposits without leaving them in the PENDING
 * bucket forever.
 *
 * Caveat at status='credited': the XLM is already in the user's smart
 * wallet, so cancelling here doesn't undo anything on chain — it just
 * stops surfacing the row as a "Resume" candidate. The funds remain in
 * the smart wallet, retrievable by a fresh deposit/spend flow later.
 * Worth a confirmation UI gate, but acceptable for the demo.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
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
  // Single atomic update — flip non-terminal rows to failed, returning
  // family_wallet_id for membership gate. Already-terminal rows return
  // zero affected rows so we can decide between 404 / no-op.
  const { data: claimed, error } = await admin
    .from("pdax_deposits")
    .update({
      status: "failed",
      failure_reason: "Cancelled by user",
    })
    .eq("identifier", identifier)
    .in("status", ["pending", "funded", "credited"])
    .select("family_wallet_id");
  if (error) {
    return NextResponse.json(
      { error: `pdax_deposits update failed: ${error.message}` },
      { status: 500 },
    );
  }

  if (!claimed?.length) {
    // Either it doesn't exist or it's already terminal. Read the existing
    // row to disambiguate so the caller gets a useful status code.
    const { data: existing } = await admin
      .from("pdax_deposits")
      .select("family_wallet_id, status")
      .eq("identifier", identifier)
      .single();
    if (!existing) {
      return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
    }
    const e = existing as { family_wallet_id: string; status: string };
    const membership = await requireFamilyMember(e.family_wallet_id);
    if (membership instanceof NextResponse) return membership;
    return NextResponse.json({ ok: true, noChange: true, status: e.status });
  }

  const c = claimed[0] as { family_wallet_id: string };
  const membership = await requireFamilyMember(c.family_wallet_id);
  if (membership instanceof NextResponse) return membership;
  return NextResponse.json({ ok: true, status: "failed" });
}
