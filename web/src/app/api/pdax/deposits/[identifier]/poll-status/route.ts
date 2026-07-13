/**
 * GET /api/pdax/deposits/[identifier]/poll-status
 *
 * Two-phase deposit driver. Each call is a fast, one-shot check; the
 * modal's existing 3s polling loop fires this until the row reaches
 * `credited` (or `failed`).
 *
 *   Phase 1 (row.status === 'pending'):
 *     Check PDAX /fiat/transactions for the InstaPay payment.
 *       IN-PROGRESS → return early; modal keeps polling.
 *       COMPLETED   → kick off PHP→token trade + crypto withdraw to relay
 *                     → mark row 'funded' → return.
 *       FAILED      → mark 'failed' → return.
 *
 *   Phase 2 (row.status === 'funded'):
 *     Check PDAX /crypto/transactions for the relay withdraw.
 *       pending     → return early; modal keeps polling.
 *       failed      → mark 'failed' → return.
 *       completed   → SAC-transfer from relay to the smart wallet
 *                     → mark 'credited' (withdraw_tx_hash = SAC tx) → return.
 *
 * The route never blocks waiting for PDAX or the chain — the polling loop
 * IS the wait. Previous design (single inline 30s wait) timed out when
 * PDAX's bookkeeping lagged behind on-chain settlement.
 *
 * Webhook from PDAX would replace phase 1 if registrable; phase 2 still
 * needs the polling loop because PDAX doesn't ping us when XLM lands.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN } from "@/lib/config";
import { pdaxErrorToResponse } from "@/lib/pdax/client";
import {
  getPdaxFiatTx,
  kickOffPdaxWithdraw,
  tryCompleteWithdrawAndTransfer,
  type PdaxFiatTransaction,
} from "@/lib/pdax/deposits";
import {
  acquireDepositClaim,
  releaseDepositClaim,
} from "@/lib/pdax/depositClaim";
import { enforceDailyLimit } from "@/lib/rateLimit";
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
      "family_wallet_id, member_id, amount_php, amount_usdc, status, created_at",
    )
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }
  const r = row as {
    family_wallet_id: string;
    member_id: string;
    amount_php: number;
    amount_usdc: number | null;
    status: string;
    created_at: string;
  };

  const ctxMember = await requireFamilyMember(r.family_wallet_id);
  if (ctxMember instanceof NextResponse) return ctxMember;

  // Defense in depth. The deposit modal polls this every 3s while the
  // pipeline advances; caps sized for a busy user with several pending
  // deposits without breaking the modal.
  const rate = await enforceDailyLimit({
    endpoint: "pdax_deposit_poll_status",
    walletId: ctxMember.memberId,
    familyWalletId: r.family_wallet_id,
    callerEmail: ctxMember.email,
    perUser: 3000,
    perFamily: 6000,
  });
  if (rate) return rate;

  if (
    r.status === "credited" ||
    r.status === "split" ||
    r.status === "failed"
  ) {
    return NextResponse.json({ ok: true, status: r.status, noChange: true });
  }

  if (r.status === "pending") {
    return await advanceFromPending({
      identifier,
      amountPhp: r.amount_php,
      createdAt: r.created_at,
    });
  }

  if (r.status === "funded") {
    if (r.amount_usdc === null) {
      // Shouldn't happen — kickoff sets amount_usdc when marking funded.
      // Bail rather than guess; surfaces in the row.
      return NextResponse.json(
        { error: "Funded row missing amount_usdc" },
        { status: 500 },
      );
    }
    // Phase 2 targets the family Sobre contract directly — `deposit_from_xlm`
    // runs there and credits envelopes atomically, no user-signed follow-up.
    // Only fetch during phase 2 so the pending stretch (which can run
    // 30-120s while the user pays InstaPay) doesn't do the work early.
    const { data: family } = await admin
      .from("family_wallets")
      .select("contract_id, percents")
      .eq("id", r.family_wallet_id)
      .single();
    if (!family) {
      return NextResponse.json(
        { error: "Family wallet not found" },
        { status: 404 },
      );
    }
    const fam = family as {
      contract_id: string;
      percents: [number, number, number];
    };
    return await advanceFromFunded({
      identifier,
      familyContractId: fam.contract_id,
      percents: fam.percents,
      expectedNetAmount: r.amount_usdc,
      kickedOffAt: r.created_at,
    });
  }

  return NextResponse.json({ ok: true, status: r.status, noChange: true });
}

async function advanceFromPending(args: {
  identifier: string;
  amountPhp: number;
  createdAt: string;
}): Promise<Response> {
  const admin = getSupabaseAdmin();
  // Staleness gate: PDAX UAT often leaves canceled/failed GrabPay sources
  // either absent from /fiat/transactions or stuck on IN-PROGRESS instead
  // of flipping to FAILED. Without a time-based fallback the modal sits
  // on "Waiting for payment…" indefinitely after the user hits GrabPay's
  // FAIL THIS TRANSACTION button. After PENDING_STALE_MS we presume the
  // checkout went bad and mark the row failed so the UI transitions to
  // the failed state. 90 seconds is aggressive enough that a clicked
  // "Fail" feels responsive, but still long enough for a real slow
  // payment to slip through — and the in-modal "Cancel" button gives the
  // user an instant escape if they want one.
  const PENDING_STALE_MS = 90_000;
  const ageMs = Date.now() - new Date(args.createdAt).getTime();
  const isStale = ageMs > PENDING_STALE_MS;
  const markFailedExpired = async () => {
    await admin
      .from("pdax_deposits")
      .update({
        status: "failed",
        failure_reason: "Checkout cancelled or expired",
      })
      .eq("identifier", args.identifier);
    return NextResponse.json({ ok: true, status: "failed" });
  };

  let pdaxTx: PdaxFiatTransaction | undefined;
  try {
    pdaxTx = await getPdaxFiatTx(args.identifier, "CashIn");
  } catch (e) {
    return pdaxErrorToResponse(e, "PDAX poll failed");
  }

  if (!pdaxTx) {
    if (isStale) return await markFailedExpired();
    return NextResponse.json({
      ok: true,
      status: "pending",
      pdaxStatus: null,
    });
  }

  if (pdaxTx.status === "FAILED") {
    await admin
      .from("pdax_deposits")
      .update({ status: "failed", failure_reason: "PDAX fiat tx FAILED" })
      .eq("identifier", args.identifier);
    return NextResponse.json({ ok: true, status: "failed" });
  }

  if (pdaxTx.status === "IN-PROGRESS") {
    if (isStale) return await markFailedExpired();
    return NextResponse.json({
      ok: true,
      status: "pending",
      pdaxStatus: "IN-PROGRESS",
    });
  }

  // COMPLETED: fiat is in. Atomically claim the right to run the
  // trade + withdraw BEFORE making the external PDAX call. The claim
  // is `claiming:<isoTimestamp>` so a handler that dies mid-trade
  // doesn't deadlock the row — a later tick can steal a stale claim
  // (>60s old) via acquireDepositClaim's path B.
  const claim = await acquireDepositClaim(admin, args.identifier, "pending");
  if (!claim) {
    // Another poll holds a fresh claim, or the row was just cancelled.
    return NextResponse.json({
      ok: true,
      status: "pending",
      race: "claimed_by_another",
    });
  }
  try {
    const { amountToken, netAmount, pdaxWithdrawTxId } =
      await kickOffPdaxWithdraw({
        identifier: args.identifier,
        amountPhp: args.amountPhp,
      });

    await admin
      .from("pdax_deposits")
      .update({
        status: "funded",
        amount_usdc: netAmount,
        token_currency: PAYMENT_TOKEN,
        // Reset so phase 2's claim (advanceFromFunded → claimSacTransfer)
        // can take over the same column.
        withdraw_tx_hash: null,
      })
      .eq("identifier", args.identifier)
      .eq("status", "pending")
      .eq("withdraw_tx_hash", claim);

    return NextResponse.json({
      ok: true,
      status: "funded",
      amountToken,
      netAmount,
      pdaxWithdrawTxId,
    });
  } catch (e) {
    // Roll the claim back so a future poll can retry (or so the
    // user can cancel) — the trade failed, no PDAX-side state to
    // protect anymore. Match the exact claim value so we never wipe
    // a hash that landed under us.
    await releaseDepositClaim(admin, args.identifier, claim);
    return await markFailedAndRespond(args.identifier, e, "kickOffPdaxWithdraw");
  }
}

async function advanceFromFunded(args: {
  identifier: string;
  familyContractId: string;
  percents: readonly [number, number, number];
  expectedNetAmount: number;
  kickedOffAt: string;
}): Promise<Response> {
  const admin = getSupabaseAdmin();
  // Atomic claim with TTL: a handler that dies between claim and
  // `deposit_from_xlm` doesn't deadlock the row — a later tick can steal
  // a stale claim via acquireDepositClaim's path B.
  let phase2Claim: string | null = null;
  const claimSacTransfer = async (): Promise<boolean> => {
    phase2Claim = await acquireDepositClaim(admin, args.identifier, "funded");
    return phase2Claim !== null;
  };
  try {
    const result = await tryCompleteWithdrawAndTransfer({
      identifier: args.identifier,
      familyContractId: args.familyContractId,
      percents: args.percents,
      expectedNetAmount: args.expectedNetAmount,
      kickedOffAt: args.kickedOffAt,
      claimSacTransfer,
    });

    if (result.state === "still_pending") {
      return NextResponse.json({
        ok: true,
        status: "funded",
        withdrawSettlement: "pending",
      });
    }

    await admin
      .from("pdax_deposits")
      .update({
        status: "credited",
        amount_usdc: result.netAmount,
        withdraw_tx_hash: result.sacTransferHash,
      })
      .eq("identifier", args.identifier);

    return NextResponse.json({
      ok: true,
      status: "credited",
      sacTransferHash: result.sacTransferHash,
      netAmount: result.netAmount,
    });
  } catch (e) {
    return await markFailedAndRespond(
      args.identifier,
      e,
      "tryCompleteWithdrawAndTransfer",
    );
  }
}

async function markFailedAndRespond(
  identifier: string,
  e: unknown,
  where: string,
): Promise<Response> {
  const admin = getSupabaseAdmin();
  const reason = e instanceof Error ? e.message : String(e);
  await admin
    .from("pdax_deposits")
    .update({ status: "failed", failure_reason: reason })
    .eq("identifier", identifier);
  console.error(`[pdax poll-status ${where}]`, reason);
  return pdaxErrorToResponse(e, `${where} failed`);
}
