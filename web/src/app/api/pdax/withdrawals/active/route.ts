/**
 * GET /api/pdax/withdrawals/active?contract_id=<C>
 *
 * Lists the signed-in member's non-terminal cashout rows for a family
 * wallet. Drives the dashboard's "Pending cashout" surface so a user
 * whose modal got closed (refresh, wifi blip, accidental dismiss in a
 * pre-locked phase) can still see where their money is and watch it
 * settle.
 *
 * Non-terminal = status ∈ {pending, spent, transferred, converted}.
 * Paid and failed are excluded — they're done.
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

  const { data: rows, error } = await admin
    .from("pdax_withdrawals")
    .select(
      "identifier, envelope, amount_usdc, amount_php, status, failure_reason, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .in("status", ["pending", "spent", "transferred", "converted"])
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: `pdax_withdrawals read failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ cashouts: rows ?? [] });
}
