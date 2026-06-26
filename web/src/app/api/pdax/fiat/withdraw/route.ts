/**
 * POST /api/pdax/fiat/withdraw
 *
 * Initiate a "Cash out via PDAX" request. Returns the artifacts the modal
 * needs to drive the user's two on-chain signatures:
 *
 *   1. spend(envelope, amount, memo) on the family Sobre — XLM moves from
 *      the envelope to the user's smart wallet. (FaceID 1)
 *   2. SAC transfer(user_smart_wallet → relayG) — XLM moves from the smart
 *      wallet to the server-side relay. (FaceID 2)
 *
 * Once both land, the modal POSTs to /confirmed with the two tx hashes and
 * the poll-status loop drives the server-side pipeline from there.
 *
 * Body shape mirrors fiat/deposit: accept `contract_id`, resolve the matching
 * family_wallets row internally. The bank fields are optional — when omitted
 * we look up `member_bank_details` for the signed-in member's default bank.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN } from "@/lib/config";
import { pdaxEnv } from "@/lib/env";
import { pdaxErrorToResponse, PdaxError } from "@/lib/pdax/client";
import { getPdaxCryptoDepositAddr } from "@/lib/pdax/withdrawals";
import { getRelayPublicKey } from "@/lib/relay";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface RequestBody {
  /** Family Sobre contract C-address. Symmetric with fiat/deposit. */
  contract_id: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  /** Token amount the user is cashing out (XLM today). Computed in the modal
   *  from the PHP amount / live rate; we pass the token amount through so the
   *  on-chain spend() and the SAC transfer use the same integer stroops the
   *  modal computed, avoiding rate-drift mismatches between client + server. */
  amount_token: number;
  /** PHP amount the user typed. Stored on the row for display continuity
   *  and to short-circuit refunds if the sell-side trade slips against us. */
  amount_php: number;
  /** Optional bank details. When omitted, we fall back to the member's
   *  default in `member_bank_details`. PDAX UAT supports only Security Bank
   *  (BASECPH) + CTBC (BACTBPH). */
  bank_code?: string;
  account_name?: string;
  account_number?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (
    !body ||
    typeof body.contract_id !== "string" ||
    typeof body.envelope !== "string" ||
    !["Groceries", "Tuition", "Savings"].includes(body.envelope) ||
    typeof body.amount_token !== "number" ||
    body.amount_token <= 0 ||
    typeof body.amount_php !== "number" ||
    body.amount_php <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid body: expect { contract_id, envelope, amount_token > 0, amount_php > 0 }",
      },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: familyRow } = await admin
    .from("family_wallets")
    .select("id")
    .eq("contract_id", body.contract_id)
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

  // Resolve bank details: explicit body fields win; otherwise look up the
  // member's default registered bank. We refuse to insert the row if neither
  // is available so the modal can surface a "Register your bank" step
  // before the user signs anything on chain.
  let bankCode = body.bank_code;
  let accountName = body.account_name;
  let accountNumber = body.account_number;
  if (!bankCode || !accountName || !accountNumber) {
    const { data: bankRow } = await admin
      .from("member_bank_details")
      .select("bank_code, account_name, account_number")
      .eq("member_id", memberId)
      .maybeSingle();
    if (!bankRow) {
      return NextResponse.json(
        {
          error:
            "No bank on file — register a Philippine bank account before cashing out",
        },
        { status: 400 },
      );
    }
    const b = bankRow as {
      bank_code: string;
      account_name: string;
      account_number: string;
    };
    bankCode = bankCode ?? b.bank_code;
    accountName = accountName ?? b.account_name;
    accountNumber = accountNumber ?? b.account_number;
  }

  const identifier = crypto.randomUUID();
  const { error: insertErr } = await admin.from("pdax_withdrawals").insert({
    identifier,
    family_wallet_id: familyWalletId,
    member_id: memberId,
    envelope: body.envelope,
    amount_usdc: body.amount_token,
    amount_php: body.amount_php,
    beneficiary_bank_code: bankCode,
    beneficiary_account_name: accountName,
    beneficiary_account_number: accountNumber,
    token_currency: PAYMENT_TOKEN,
    status: "pending",
  });
  if (insertErr) {
    return NextResponse.json(
      { error: `pdax_withdrawals insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  const relayG = getRelayPublicKey();

  // ─── Mock-mode short-circuit ──────────────────────────────────────────
  if (pdaxEnv().mock) {
    return NextResponse.json({
      identifier,
      relayG,
      mock: true,
    });
  }

  // Resolve PDAX's deposit address + memo now so it travels with the
  // response. Cached at module level on /lib/pdax/withdrawals, so this is
  // a single round-trip per process lifetime.
  try {
    await getPdaxCryptoDepositAddr();
  } catch (e) {
    await admin
      .from("pdax_withdrawals")
      .update({
        status: "failed",
        failure_reason: e instanceof Error ? e.message : String(e),
      })
      .eq("identifier", identifier);
    if (e instanceof PdaxError) {
      console.error("[pdax fiat/withdraw]", e.status, JSON.stringify(e.body));
    }
    return pdaxErrorToResponse(e, "Failed to resolve PDAX deposit address");
  }

  return NextResponse.json({ identifier, relayG });
}
