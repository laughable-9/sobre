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

import { requireFamilyParticipant } from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN, STROOPS_PER_TOKEN } from "@/lib/config";
import { pdaxErrorToResponse } from "@/lib/pdax/client";
import {
  getPdaxFiatTx,
  type PdaxFiatTransaction,
} from "@/lib/pdax/deposits";
import {
  convertAndPayoutPhp,
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
  processing_since: string | null;
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
      "family_wallet_id, member_id, amount_usdc, amount_php, envelope, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, status, transfer_tx_hash, processing_since",
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

  // Admit sub-account holders too — the row's owner polls this on every
  // tick until paid/failed; it's their cashout to watch.
  const membership = await requireFamilyParticipant(r.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  // Family-scope auth admits peers; gate ownership too so a peer can't
  // drive another participant's state machine (or trigger PDAX-side
  // side-effects against rows they don't own).
  if (r.member_id !== membership.memberId) {
    return NextResponse.json({ error: "Not your cashout" }, { status: 403 });
  }

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

  if (r.status === "processing") {
    return await advanceFromProcessing({
      identifier,
      processingSince: r.processing_since,
    });
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

  // Horizon confirmation alone advances the row. The relay's classic
  // Stellar payment is atomic — once Horizon marks the tx successful, the
  // XLM is in PDAX's custody at their deposit address with the correct
  // memo, full stop. Their own /crypto/transactions accounting is silent
  // on inbound deposits in UAT (probably broken, definitely unreliable);
  // there's no value in waiting for a signal that may never arrive when
  // the underlying chain payment is already final.
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

  await admin
    .from("pdax_withdrawals")
    .update({ status: "transferred" })
    .eq("identifier", args.identifier)
    .eq("status", "spent");
  return NextResponse.json({ ok: true, status: "transferred" });
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
    pdaxTx = await getPdaxFiatTx(args.identifier, "CashOut");
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

  // COMPLETED from PDAX means *they* accepted the withdrawal request,
  // not that InstaPay has actually settled to the user's bank. PDAX
  // sends two distinct emails: "Request Is Being Processed" first
  // (their internal accept) and "Has Been Processed" later (real
  // settlement). Marking paid on the first signal lies to the user
  // and we lose trust when their email lags our toast.
  //
  // Move to `processing` instead and let advanceFromProcessing decide
  // when it's safe to call paid — either the fiat WITHDRAWAL webhook
  // arrives, or the conservative wait elapses.
  await admin
    .from("pdax_withdrawals")
    .update({
      status: "processing",
      processing_since: new Date().toISOString(),
      amount_php: pdaxTx.amount !== undefined ? Number(pdaxTx.amount) : null,
    })
    .eq("identifier", args.identifier)
    .eq("status", "converted");
  return NextResponse.json({ ok: true, status: "processing" });
}

/** processing → paid. The authoritative signal is PDAX's fiat WITHDRAWAL
 *  webhook with status=COMPLETED, which `handleFiat` upgrades to `paid`
 *  on its own. In dev/preview without a webhook URL this never fires,
 *  so we fall back to a time-based promotion: after PROCESSING_GRACE_MS
 *  in the processing state, we re-check PDAX and promote to paid (or
 *  failed) based on the live tx status.
 *
 *  The grace period exists purely so the user-facing copy doesn't lie.
 *  PDAX UAT may settle instantly, but giving "processing" 10 seconds of
 *  airtime gives the user a chance to read the state and (more
 *  importantly) for PDAX's settlement email to actually arrive before
 *  the dashboard's "₱X arrived in your bank" toast fires.
 *
 *  Before promoting, we re-fetch /fiat/transactions one more time.
 *  Without the webhook we'd otherwise be flying blind: a row that PDAX
 *  flips COMPLETED → FAILED inside the 10s window (rare, but plausible
 *  with bank-side rejections like PRC011) would still be promoted to
 *  paid, and the dashboard would lie about settlement. The recheck
 *  costs one PDAX call per cashout and gives us a faithful signal. */
async function advanceFromProcessing(args: {
  identifier: string;
  processingSince: string | null;
}): Promise<Response> {
  const admin = getSupabaseAdmin();
  const PROCESSING_GRACE_MS = 10_000;
  const since = args.processingSince
    ? new Date(args.processingSince).getTime()
    : Date.now();
  const elapsed = Date.now() - since;
  if (elapsed < PROCESSING_GRACE_MS) {
    return NextResponse.json({
      ok: true,
      status: "processing",
      msRemaining: PROCESSING_GRACE_MS - elapsed,
    });
  }
  // Re-check PDAX before promoting. If they've flipped the tx to FAILED
  // inside the grace window, mark the row failed instead of silently
  // promoting to paid. If the call itself fails we fall back to the
  // time-based promotion — better a small lie than stranding the row
  // in `processing` forever if PDAX's API is temporarily flaky.
  let pdaxTx: PdaxFiatTransaction | undefined;
  try {
    pdaxTx = await getPdaxFiatTx(args.identifier, "CashOut");
  } catch (e) {
    console.warn(
      "[pdax withdraw poll-status advanceFromProcessing] PDAX recheck failed; falling back to time-based promote",
      e,
    );
  }
  if (pdaxTx?.status === "FAILED") {
    const raw = pdaxTx as unknown as Record<string, unknown>;
    const failureReason =
      (raw.rejection_reason as string | undefined) ??
      (raw.fail_reason as string | undefined) ??
      "PDAX rejected the bank settlement";
    await admin
      .from("pdax_withdrawals")
      .update({ status: "failed", failure_reason: failureReason })
      .eq("identifier", args.identifier)
      .eq("status", "processing");
    return NextResponse.json({ ok: true, status: "failed" });
  }
  await admin
    .from("pdax_withdrawals")
    .update({ status: "paid" })
    .eq("identifier", args.identifier)
    .eq("status", "processing");
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
