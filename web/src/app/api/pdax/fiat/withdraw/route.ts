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

import {
  requireFamilyMember,
  requireFamilyParticipant,
} from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN, PDAX_INSTAPAY_FEE_PHP } from "@/lib/config";
import { pdaxEnv } from "@/lib/env";
import { pdaxErrorToResponse, PdaxError } from "@/lib/pdax/client";
import { getPdaxCryptoDepositAddr } from "@/lib/pdax/withdrawals";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getRelayPublicKey } from "@/lib/relay";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface RequestBody {
  /** Family Sobre contract C-address. Symmetric with fiat/deposit. */
  contract_id: string;
  /** Member cashout: which envelope to debit. Mutually exclusive with
   *  subaccount_id; the route validates exactly one is set. */
  envelope?: "Groceries" | "Tuition" | "Savings";
  /** Sub-account cashout: family_subaccounts row id. The spend leg becomes
   *  spend_from_subaccount instead of spend; envelope is left NULL on the
   *  pdax_withdrawals row. */
  subaccount_id?: string;
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
  /** Optional caller-supplied identifier. The server-fallback recovery
   *  flow passes the original cashout's identifier here so we don't mint
   *  a fresh UUID and leave an orphan `pending` row alongside the real
   *  one — which is what /recoverable would keep re-surfacing forever.
   *  When the identifier is provided AND a row already exists for it,
   *  this endpoint short-circuits the insert and returns the same
   *  `relayG`, making the call safely idempotent. */
  identifier?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  // Source XOR: exactly one of envelope / subaccount_id.
  const envelopeValid =
    typeof body?.envelope === "string" &&
    ["Groceries", "Tuition", "Savings"].includes(body.envelope);
  const subaccountValid =
    typeof body?.subaccount_id === "string" && body.subaccount_id.length > 0;
  if (
    !body ||
    typeof body.contract_id !== "string" ||
    typeof body.amount_token !== "number" ||
    body.amount_token <= 0 ||
    typeof body.amount_php !== "number" ||
    body.amount_php <= 0 ||
    (envelopeValid === subaccountValid)
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid body: expect { contract_id, amount_token>0, amount_php>0, and exactly one of envelope or subaccount_id }",
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

  // Sub-account cashouts admit the sub-account holder. Member cashouts
  // gate to family_members only — sub-accounts can't initiate a
  // cashout against an envelope they don't own.
  const ctx = subaccountValid
    ? await requireFamilyParticipant(familyWalletId)
    : await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;
  const { memberId } = ctx;

  const rate = await enforceDailyLimit({
    endpoint: "pdax_fiat_withdraw",
    walletId: memberId,
    familyWalletId,
    callerEmail: ctx.email,
    perUser: 10,
    perFamily: 30,
  });
  if (rate) return rate;

  // When this is a sub-account cashout, verify the caller is actually the
  // owner of that sub-account row. Without this any participant could pass
  // somebody else's subaccount_id and cash out from their balance.
  if (subaccountValid) {
    const { data: subRow } = await admin
      .from("family_subaccounts")
      .select("id, wallet_id, family_wallet_id")
      .eq("id", body.subaccount_id!)
      .maybeSingle();
    if (
      !subRow ||
      (subRow as { wallet_id: string | null }).wallet_id !== memberId ||
      (subRow as { family_wallet_id: string }).family_wallet_id !==
        familyWalletId
    ) {
      return NextResponse.json(
        { error: "Not your sub-account" },
        { status: 403 },
      );
    }
  }

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

  const relayG = getRelayPublicKey();

  // Idempotency: if the caller supplied an identifier we've already seen,
  // skip the insert and return the existing row's relayG. The recovery
  // flow needs this so it can re-resolve the relay address for an
  // existing pending row without minting a fresh orphan.
  if (body.identifier) {
    const { data: existing } = await admin
      .from("pdax_withdrawals")
      .select("identifier, family_wallet_id, status")
      .eq("identifier", body.identifier)
      .maybeSingle();
    if (existing) {
      const e = existing as { family_wallet_id: string; status: string };
      if (e.family_wallet_id !== familyWalletId) {
        return NextResponse.json(
          { error: "Identifier belongs to another wallet" },
          { status: 403 },
        );
      }
      return NextResponse.json({
        identifier: body.identifier,
        relayG,
        resumed: true,
        status: e.status,
      });
    }
  }

  const identifier = body.identifier ?? crypto.randomUUID();
  // amount_php stored on the row = what lands at the user's bank (the
  // number they typed in the modal). service_fee_php = PDAX's InstaPay
  // fee, taken from the sold USDC proceeds before the bank transfer.
  // amount_usdc is the pre-fee on-chain spend, so amount_usdc's PHP
  // conversion ~= amount_php + service_fee_php. Server-side config is
  // the source of truth so client can't lie about the fee.
  const { error: insertErr } = await admin.from("pdax_withdrawals").insert({
    identifier,
    family_wallet_id: familyWalletId,
    member_id: memberId,
    envelope: subaccountValid ? null : body.envelope,
    subaccount_id: subaccountValid ? body.subaccount_id : null,
    amount_usdc: body.amount_token,
    amount_php: body.amount_php,
    service_fee_php: PDAX_INSTAPAY_FEE_PHP,
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
