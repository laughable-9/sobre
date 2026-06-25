/**
 * POST /api/pdax/fiat/withdraw
 *
 * Initiate a "Cash out via PDAX" request. Two-step on the frontend:
 *
 *   1. Call this route → pre-creates the `pdax_withdrawals` row in 'pending'
 *      status, returns { identifier, pdaxUsdcAddress, pdaxUsdcMemo? }.
 *   2. Frontend runs spend() on the family Sobre contract (FaceID 1).
 *   3. Frontend runs SAC.transfer to the pdaxUsdcAddress (FaceID 2).
 *   4. PDAX detects the incoming USDC, fires the crypto webhook → webhook
 *      handler converts USDC→PHP + initiates the fiat payout to the bank.
 *
 * The on-chain side is the user's job (their passkey signs); this route is
 * just the row-setup + address-fetch step.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { pdaxEnv } from "@/lib/env";
import { pdaxFetch, PdaxError } from "@/lib/pdax/client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface RequestBody {
  family_wallet_id: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  amount_usdc: number;
  bank_code: string;
  account_name: string;
  account_number: string;
}

interface PdaxDepositAddrResponse {
  data: { currency: string; address: string; tag?: string };
  status: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (
    !body ||
    typeof body.family_wallet_id !== "string" ||
    typeof body.amount_usdc !== "number" ||
    body.amount_usdc <= 0 ||
    !["Groceries", "Tuition", "Savings"].includes(body.envelope) ||
    typeof body.bank_code !== "string" ||
    typeof body.account_name !== "string" ||
    typeof body.account_number !== "string"
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const ctx = await requireFamilyMember(body.family_wallet_id);
  if (ctx instanceof NextResponse) return ctx;
  const { memberId } = ctx;

  const admin = getSupabaseAdmin();
  const identifier = crypto.randomUUID();
  const { error: insertErr } = await admin.from("pdax_withdrawals").insert({
    identifier,
    family_wallet_id: body.family_wallet_id,
    member_id: memberId,
    envelope: body.envelope,
    amount_usdc: body.amount_usdc,
    beneficiary_bank_code: body.bank_code,
    beneficiary_account_name: body.account_name,
    beneficiary_account_number: body.account_number,
    status: "pending",
  });
  if (insertErr) {
    return NextResponse.json(
      { error: `pdax_withdrawals insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  // ─── Mock-mode short-circuit ──────────────────────────────────────────
  if (pdaxEnv().mock) {
    return NextResponse.json({
      identifier,
      pdaxUsdcAddress: "GMOCK_USDC_DEPOSIT_ADDRESS_FOR_TESTING",
      mock: true,
    });
  }

  // PDAX's USDC deposit address — the G-address we send our USDC to. PDAX
  // detects it via webhook and credits the institution account.
  try {
    const addr = await pdaxFetch<PdaxDepositAddrResponse>(
      "/pdax-institution/v1/crypto/deposit",
      { query: { currency: "USDCXLM" } },
    );
    return NextResponse.json({
      identifier,
      pdaxUsdcAddress: addr.data.address,
      pdaxUsdcMemo: addr.data.tag,
    });
  } catch (e) {
    await admin
      .from("pdax_withdrawals")
      .update({
        status: "failed",
        failure_reason: e instanceof Error ? e.message : String(e),
      })
      .eq("identifier", identifier);
    if (e instanceof PdaxError) {
      return NextResponse.json(
        { error: "PDAX rejected", pdax: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
