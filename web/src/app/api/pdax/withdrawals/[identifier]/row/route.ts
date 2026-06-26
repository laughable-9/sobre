/**
 * GET /api/pdax/withdrawals/[identifier]/row
 *
 * Single cashout row by identifier, auth-gated to family-wallet members.
 * Used by usePdaxWithdraw when hydrating on resume — the modal needs the
 * row up-front before Realtime takes over.
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
    .from("pdax_withdrawals")
    .select(
      "identifier, envelope, amount_usdc, amount_php, status, failure_reason, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, family_wallet_id",
    )
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Cashout not found" }, { status: 404 });
  }
  const r = row as {
    identifier: string;
    envelope: "Groceries" | "Tuition" | "Savings";
    amount_usdc: number;
    amount_php: number | null;
    status: string;
    failure_reason: string | null;
    beneficiary_bank_code: string;
    beneficiary_account_name: string;
    beneficiary_account_number: string;
    family_wallet_id: string;
  };

  const membership = await requireFamilyMember(r.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  return NextResponse.json({
    cashout: {
      identifier: r.identifier,
      envelope: r.envelope,
      amount_usdc: r.amount_usdc,
      amount_php: r.amount_php,
      status: r.status,
      failure_reason: r.failure_reason,
      beneficiary_bank_code: r.beneficiary_bank_code,
      beneficiary_account_name: r.beneficiary_account_name,
      beneficiary_account_number: r.beneficiary_account_number,
    },
  });
}
