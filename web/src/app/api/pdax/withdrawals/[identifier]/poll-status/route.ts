/**
 * GET /api/pdax/withdrawals/[identifier]/poll-status
 *
 * Three-phase cashout driver. Each call is a single-shot state advancer;
 * the modal's 1s polling loop fires this until status reaches `paid` or
 * `failed`.
 *
 *   Phase A (row.status === 'spent'):
 *     XLM is at the relay. Atomically claim `transfer_tx_hash`, submit the
 *     relay's classic payment to PDAX (with memo_id), then poll PDAX
 *     /crypto/transactions to confirm the credit.
 *       still polling → return early (modal keeps polling)
 *       PDAX credited → mark 'transferred' → return
 *
 *   Phase B (row.status === 'transferred'):
 *     Run sell-side trade + /fiat/withdraw. Marks 'converted' on success.
 *
 *   Phase C (row.status === 'converted'):
 *     Poll PDAX /fiat/transactions for the WITHDRAWAL row to flip to
 *     COMPLETED. Marks 'paid' on success.
 *
 * Atomic claims on each transition prevent double-actions when concurrent
 * polls race. Mirrors lib/relay.ts and the deposit poll-status pattern.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN, STROOPS_PER_TOKEN } from "@/lib/config";
import { pdaxErrorToResponse, pdaxFetch } from "@/lib/pdax/client";
import type {
  PdaxFiatTransaction,
  PdaxFiatTransactionsResponse,
} from "@/lib/pdax/deposits";
import {
  convertAndPayoutPhp,
  findPdaxCryptoCredit,
  getPdaxCryptoDepositAddr,
  isRelayPaymentIncluded,
} from "@/lib/pdax/withdrawals";
import { submitClassicPayment } from "@/lib/relay";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface WithdrawRow {
  family_wallet_id: string;
  member_id: string;
  amount_usdc: number;
  amount_php: number | null;
  envelope: "Groceries" | "Tuition" | "Savings";
  beneficiary_bank_code: string;
  beneficiary_account_name: string;
  beneficiary_account_number: string;
  status: string;
  transfer_tx_hash: string | null;
}

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
      "family_wallet_id, member_id, amount_usdc, amount_php, envelope, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, status, transfer_tx_hash",
    )
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json(
      { error: "Withdrawal not found" },
      { status: 404 },
    );
  }
  const r = row as WithdrawRow;

  const membership = await requireFamilyMember(r.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  if (r.status === "paid" || r.status === "failed") {
    return NextResponse.json({ ok: true, status: r.status, noChange: true });
  }

  if (r.status === "spent") {
    return await advanceFromSpent({
      identifier,
      amountToken: r.amount_usdc,
      transferTxHash: r.transfer_tx_hash,
    });
  }

  if (r.status === "transferred") {
    if (!r.amount_php) {
      return NextResponse.json(
        { error: "Row missing amount_php — can't run sell trade" },
        { status: 500 },
      );
    }
    return await advanceFromTransferred({
      identifier,
      amountPhp: r.amount_php,
      bankCode: r.beneficiary_bank_code,
      accountName: r.beneficiary_account_name,
      accountNumber: r.beneficiary_account_number,
    });
  }

  if (r.status === "converted") {
    return await advanceFromConverted({ identifier });
  }

  // pending — user hasn't signed yet. Modal drives that step locally.
  return NextResponse.json({ ok: true, status: r.status, noChange: true });
}

async function advanceFromSpent(args: {
  identifier: string;
  amountToken: number;
  transferTxHash: string | null;
}): Promise<Response> {
  const admin = getSupabaseAdmin();

  // Atomic claim: only one concurrent poll wins the right to submit the
  // relay's outbound classic payment. Loser bails with still_pending.
  // The sentinel "submitting" gets overwritten with the actual Stellar tx
  // hash once submitClassicPayment returns.
  if (args.transferTxHash === null) {
    const { data: claimed } = await admin
      .from("pdax_withdrawals")
      .update({ transfer_tx_hash: "submitting" })
      .eq("identifier", args.identifier)
      .is("transfer_tx_hash", null)
      .select("identifier");
    if (!claimed?.length) {
      return NextResponse.json({
        ok: true,
        status: "spent",
        relayLeg: "claimed_by_another",
      });
    }
    try {
      const addr = await getPdaxCryptoDepositAddr();
      const stroops = BigInt(Math.round(args.amountToken * STROOPS_PER_TOKEN));
      const hash = await submitClassicPayment({
        destinationG: addr.address,
        stroops,
        memoId: addr.memo,
      });
      await admin
        .from("pdax_withdrawals")
        .update({ transfer_tx_hash: hash })
        .eq("identifier", args.identifier);
      return NextResponse.json({
        ok: true,
        status: "spent",
        relayLeg: "submitted",
        transferTxHash: hash,
      });
    } catch (e) {
      // Roll back the claim sentinel so a future poll can retry. Don't mark
      // failed here — the SAC transfer to relay already landed, the user's
      // money is at the relay, retry is the right move.
      await admin
        .from("pdax_withdrawals")
        .update({ transfer_tx_hash: null })
        .eq("identifier", args.identifier)
        .eq("transfer_tx_hash", "submitting");
      return await markFailedAndRespond(
        args.identifier,
        e,
        "submitClassicPayment",
      );
    }
  }

  if (args.transferTxHash === "submitting") {
    return NextResponse.json({
      ok: true,
      status: "spent",
      relayLeg: "submitting",
    });
  }

  // We have a real hash. One-shot Horizon check — the modal's 3s poll
  // means a NOT_FOUND just retries on the next tick rather than blocking
  // this response for 30s.
  const horizonOk = await isRelayPaymentIncluded({
    submittedHash: args.transferTxHash,
  });
  if (!horizonOk) {
    return NextResponse.json({
      ok: true,
      status: "spent",
      relayLeg: "horizon_pending",
    });
  }

  try {
    const credit = await findPdaxCryptoCredit({
      transactionHash: args.transferTxHash,
    });
    if (!credit || credit.status !== "completed") {
      return NextResponse.json({
        ok: true,
        status: "spent",
        relayLeg: "pdax_pending",
      });
    }
    await admin
      .from("pdax_withdrawals")
      .update({ status: "transferred" })
      .eq("identifier", args.identifier)
      .eq("status", "spent");
    return NextResponse.json({ ok: true, status: "transferred" });
  } catch (e) {
    return pdaxErrorToResponse(e, "PDAX /crypto/transactions poll failed");
  }
}

async function advanceFromTransferred(args: {
  identifier: string;
  amountPhp: number;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}): Promise<Response> {
  const admin = getSupabaseAdmin();

  // Atomic claim: flip status transferred→converted before running trade
  // + fiat withdraw. The trade is idempotent on `idempotency_id` and the
  // fiat withdraw is idempotent on `identifier`, so a duplicate call after
  // a crash is safe — but we still gate so the happy-path doesn't double-
  // fire the trade between two concurrent polls.
  const { data: claimed } = await admin
    .from("pdax_withdrawals")
    .update({ status: "converted" })
    .eq("identifier", args.identifier)
    .eq("status", "transferred")
    .select("identifier");
  if (!claimed?.length) {
    return NextResponse.json({ ok: true, status: "converted" });
  }

  try {
    const { totalPhp } = await convertAndPayoutPhp({
      identifier: args.identifier,
      amountPhp: args.amountPhp,
      bankCode: args.bankCode,
      accountName: args.accountName,
      accountNumber: args.accountNumber,
    });
    await admin
      .from("pdax_withdrawals")
      .update({ amount_php: totalPhp, token_currency: PAYMENT_TOKEN })
      .eq("identifier", args.identifier);
    return NextResponse.json({ ok: true, status: "converted", totalPhp });
  } catch (e) {
    return await markFailedAndRespond(args.identifier, e, "convertAndPayoutPhp");
  }
}

async function advanceFromConverted(args: {
  identifier: string;
}): Promise<Response> {
  const admin = getSupabaseAdmin();
  let pdaxTx: PdaxFiatTransaction | undefined;
  try {
    const resp = await pdaxFetch<PdaxFiatTransactionsResponse>(
      "/pdax-institution/v1/fiat/transactions",
      {
        query: {
          identifier: args.identifier,
          mode: "CashOut",
          page: 1,
          pageSize: 10,
        },
      },
    );
    pdaxTx = resp.data.find((t) => t.identifier === args.identifier);
  } catch (e) {
    return pdaxErrorToResponse(e, "PDAX /fiat/transactions poll failed");
  }

  if (!pdaxTx) {
    return NextResponse.json({
      ok: true,
      status: "converted",
      payoutStatus: null,
    });
  }

  if (pdaxTx.status === "FAILED") {
    await admin
      .from("pdax_withdrawals")
      .update({ status: "failed", failure_reason: "PDAX fiat WITHDRAWAL FAILED" })
      .eq("identifier", args.identifier);
    return NextResponse.json({ ok: true, status: "failed" });
  }

  if (pdaxTx.status === "IN-PROGRESS") {
    return NextResponse.json({
      ok: true,
      status: "converted",
      payoutStatus: "IN-PROGRESS",
    });
  }

  // COMPLETED — bank received the PHP.
  await admin
    .from("pdax_withdrawals")
    .update({
      status: "paid",
      amount_php: pdaxTx.amount !== undefined ? Number(pdaxTx.amount) : null,
    })
    .eq("identifier", args.identifier);
  return NextResponse.json({ ok: true, status: "paid" });
}

async function markFailedAndRespond(
  identifier: string,
  e: unknown,
  where: string,
): Promise<Response> {
  const admin = getSupabaseAdmin();
  const reason = e instanceof Error ? e.message : String(e);
  await admin
    .from("pdax_withdrawals")
    .update({ status: "failed", failure_reason: reason })
    .eq("identifier", identifier);
  console.error(`[pdax withdraw poll-status ${where}]`, reason);
  return pdaxErrorToResponse(e, `${where} failed`);
}
