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
import { pdaxErrorToResponse, pdaxFetch } from "@/lib/pdax/client";
import {
  kickOffPdaxWithdraw,
  tryCompleteWithdrawAndTransfer,
  type PdaxFiatTransaction,
  type PdaxFiatTransactionsResponse,
} from "@/lib/pdax/deposits";
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
    // Only phase 2 needs the smart-wallet C-address — fetching it during
    // the pending stretch (which can run for 30-120s while the user pays
    // InstaPay) is wasted work.
    const { data: wallet } = await admin
      .from("wallets")
      .select("contract_id")
      .eq("id", r.member_id)
      .single();
    if (!wallet) {
      return NextResponse.json(
        { error: "Member wallet not found" },
        { status: 404 },
      );
    }
    return await advanceFromFunded({
      identifier,
      destinationAddress: (wallet as { contract_id: string }).contract_id,
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
  // the failed state. False positives just mean the user retries with a
  // fresh checkout — cheap.
  const PENDING_STALE_MS = 5 * 60_000;
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
    const resp = await pdaxFetch<PdaxFiatTransactionsResponse>(
      "/pdax-institution/v1/fiat/transactions",
      {
        query: {
          identifier: args.identifier,
          mode: "CashIn",
          page: 1,
          pageSize: 10,
        },
      },
    );
    pdaxTx = resp.data.find((t) => t.identifier === args.identifier);
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

  // COMPLETED: fiat is in, kick off the withdraw → relay.
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
      })
      .eq("identifier", args.identifier)
      .eq("status", "pending");

    return NextResponse.json({
      ok: true,
      status: "funded",
      amountToken,
      netAmount,
      pdaxWithdrawTxId,
    });
  } catch (e) {
    return await markFailedAndRespond(args.identifier, e, "kickOffPdaxWithdraw");
  }
}

async function advanceFromFunded(args: {
  identifier: string;
  destinationAddress: string;
  expectedNetAmount: number;
  kickedOffAt: string;
}): Promise<Response> {
  const admin = getSupabaseAdmin();
  // Atomic claim: flip withdraw_tx_hash from NULL to a sentinel. Only one
  // concurrent poll wins; the rest see still_pending and bail. The sentinel
  // is replaced with the actual Stellar tx hash once the SAC transfer
  // confirms.
  const claimSacTransfer = async (): Promise<boolean> => {
    const { data } = await admin
      .from("pdax_deposits")
      .update({ withdraw_tx_hash: "claiming" })
      .eq("identifier", args.identifier)
      .is("withdraw_tx_hash", null)
      .select("identifier");
    return (data?.length ?? 0) > 0;
  };
  try {
    const result = await tryCompleteWithdrawAndTransfer({
      identifier: args.identifier,
      destinationAddress: args.destinationAddress,
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
