/**
 * GET /api/pdax/deposits/[identifier]/row
 *
 * Returns the single deposit row matching `identifier`, auth-gated to the
 * family wallet's members. Used by `usePdaxDeposit` to hydrate state when
 * resuming a deposit from the activity feed: we don't have the row in the
 * hook's memory yet, so the modal does one fetch up-front before letting
 * Realtime take over.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await ctx.params;
  if (!identifier) {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("pdax_deposits")
    .select(
      "identifier, amount_php, amount_usdc, payment_checkout_url, status, failure_reason, family_wallet_id",
    )
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }
  const r = row as {
    identifier: string;
    amount_php: number;
    amount_usdc: number | null;
    payment_checkout_url: string | null;
    status: string;
    failure_reason: string | null;
    family_wallet_id: string;
  };

  const membership = await requireFamilyMember(r.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  // Strip the family_wallet_id before returning — it's used only for the
  // membership gate, not the deposit row shape callers expect.
  return NextResponse.json({
    deposit: {
      identifier: r.identifier,
      amount_php: r.amount_php,
      amount_usdc: r.amount_usdc,
      payment_checkout_url: r.payment_checkout_url,
      status: r.status,
      failure_reason: r.failure_reason,
    },
  });
}
