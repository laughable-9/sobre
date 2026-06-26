/**
 * GET /api/pdax/deposits/active?contract_id=<C>
 *
 * Returns the signed-in member's non-terminal deposit rows for a family
 * wallet. Drives the dashboard's "pending deposits" surface so a user who
 * closed the modal mid-flow (most importantly while the row was at
 * `credited` — XLM in their smart wallet, envelopes still empty) can
 * see and resume the deposit from the activity feed.
 *
 * Non-terminal = status in {pending, funded, credited}. `split` and
 * `failed` are excluded because they're done from the modal's POV.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json(
      { error: "Missing contract_id query param" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: familyRow } = await admin
    .from("family_wallets")
    .select("id")
    .eq("contract_id", contractId)
    .single();
  if (!familyRow) {
    return NextResponse.json(
      { error: "Family wallet not found for this contract" },
      { status: 404 },
    );
  }
  const familyWalletId = (familyRow as { id: string }).id;

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;
  const { memberId } = ctx;

  // GrabPay/PayMongo source URLs hard-expire after roughly an hour; once
  // they do, PDAX never flips the corresponding /fiat/transactions row to
  // COMPLETED and our `pending` row sits in the bucket forever. Eagerly
  // mark anything past PENDING_TTL_MIN as failed before returning so the
  // PENDING list stays honest.
  const PENDING_TTL_MIN = 60;
  const cutoff = new Date(
    Date.now() - PENDING_TTL_MIN * 60_000,
  ).toISOString();
  await admin
    .from("pdax_deposits")
    .update({
      status: "failed",
      failure_reason: "Checkout expired",
    })
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .eq("status", "pending")
    .lt("created_at", cutoff);

  const { data: rows, error } = await admin
    .from("pdax_deposits")
    .select(
      "identifier, amount_php, amount_usdc, payment_checkout_url, status, failure_reason, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .in("status", ["pending", "funded", "credited"])
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: `pdax_deposits read failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ deposits: rows ?? [] });
}
