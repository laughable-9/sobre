/**
 * GET / PUT /api/member/bank
 *
 * Per-member default beneficiary bank for PDAX cashouts. One row per member
 * — last upsert wins. The cashout modal calls GET on mount to decide
 * whether to short-circuit to the input step or surface the registration
 * form first.
 *
 * PDAX UAT supports two banks only: Security Bank (BASECPH) and CTBC
 * (BACTBPH). We don't enforce the bank-code whitelist here — the UAT
 * cashout will reject anything else when /fiat/withdraw runs.
 */

import { NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const r = await requireWallet();
  if (r instanceof NextResponse) return r;

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("member_bank_details")
    .select("bank_code, account_name, account_number")
    .eq("member_id", r.memberId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ bank: null });
  }
  return NextResponse.json({ bank: row });
}

interface PutBody {
  bank_code: string;
  account_name: string;
  account_number: string;
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (
    !body ||
    typeof body.bank_code !== "string" ||
    typeof body.account_name !== "string" ||
    typeof body.account_number !== "string" ||
    !body.bank_code.trim() ||
    !body.account_name.trim() ||
    !body.account_number.trim()
  ) {
    return NextResponse.json(
      { error: "Invalid body: expect { bank_code, account_name, account_number }" },
      { status: 400 },
    );
  }

  const r = await requireWallet();
  if (r instanceof NextResponse) return r;

  const admin = getSupabaseAdmin();
  const { error: upsertErr } = await admin.from("member_bank_details").upsert(
    {
      member_id: r.memberId,
      bank_code: body.bank_code.trim(),
      account_name: body.account_name.trim(),
      account_number: body.account_number.trim(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id" },
  );
  if (upsertErr) {
    return NextResponse.json(
      { error: `member_bank_details upsert failed: ${upsertErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
