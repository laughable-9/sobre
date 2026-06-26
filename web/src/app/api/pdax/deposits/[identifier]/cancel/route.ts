/**
 * POST /api/pdax/deposits/[identifier]/cancel
 *
 * Marks an in-flight deposit row as `failed` with a "Cancelled by user"
 * reason. Used by the activity feed's "Discard" affordance so users can
 * clear out abandoned deposits without leaving them in the PENDING
 * bucket forever.
 *
 * Safety net: before marking failed, we check PDAX's /fiat/transactions
 * for the identifier. If they show COMPLETED, the user has already paid
 * and cancelling here would strand the PHP at PDAX (our pipeline never
 * triggers the trade + crypto withdraw). In that case we return a 409
 * with `code: "already_paid"` so the modal / activity feed can keep
 * letting poll-status drive the deposit to completion instead.
 *
 * Cancellable states: only `pending` rows with no in-flight trade
 * claim (`withdraw_tx_hash IS NULL`). Past that, the PHP→XLM trade
 * has already happened on PDAX's side or the XLM is already on the
 * way to the relay, and cancelling here would either strand the trade
 * or wipe the resume affordance without unwinding anything on chain.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { PdaxError } from "@/lib/pdax/client";
import { getPdaxFiatTx } from "@/lib/pdax/deposits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await ctx.params;
  if (!identifier) {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Pre-check: did PDAX already receive the PHP? If so, we MUST NOT
  // cancel — doing so leaves the institution balance with money the
  // user paid for but our pipeline never converts to XLM. Returns 409
  // so the client can show a "Already paid, completing your deposit"
  // toast and let poll-status take over.
  //
  // Only relevant for status='pending'. funded/credited mean we've
  // already moved money in our system, and PDAX is no longer the
  // source of truth for "was this paid".
  try {
    const { data: existing } = await admin
      .from("pdax_deposits")
      .select("status")
      .eq("identifier", identifier)
      .single();
    if (existing && (existing as { status: string }).status === "pending") {
      const tx = await getPdaxFiatTx(identifier, "CashIn");
      if (tx && tx.status === "COMPLETED") {
        return NextResponse.json(
          {
            error: "Payment already received — cancel refused",
            code: "already_paid",
          },
          { status: 409 },
        );
      }
    }
  } catch (e) {
    // PDAX errored — fail safe. Without a confirmed COMPLETED signal we
    // proceed with the cancel; the 90s staleness check would mark it
    // failed anyway if PDAX never surfaces it. Log so we notice
    // patterns, but don't block.
    if (e instanceof PdaxError) {
      console.warn(
        "[deposit cancel] PDAX pre-check errored:",
        e.status,
        JSON.stringify(e.body),
      );
    }
  }

  // Single atomic update — flip pending rows to failed, returning
  // family_wallet_id for membership gate. Already-terminal AND
  // mid-claim rows return zero affected rows so we bail with
  // noChange and let poll-status keep driving them.
  //
  // The `.is("withdraw_tx_hash", null)` guard is the cancel/trade
  // race protection: poll-status flips withdraw_tx_hash to
  // 'claiming' before calling kickOffPdaxWithdraw, so any concurrent
  // cancel here is refused while the external PDAX trade is in
  // flight — preventing a failed row with stranded XLM at the relay.
  const { data: claimed, error } = await admin
    .from("pdax_deposits")
    .update({
      status: "failed",
      failure_reason: "Cancelled by user",
    })
    .eq("identifier", identifier)
    .eq("status", "pending")
    .is("withdraw_tx_hash", null)
    .select("family_wallet_id");
  if (error) {
    return NextResponse.json(
      { error: `pdax_deposits update failed: ${error.message}` },
      { status: 500 },
    );
  }

  if (!claimed?.length) {
    // Either it doesn't exist or it's already terminal. Read the existing
    // row to disambiguate so the caller gets a useful status code.
    const { data: existing } = await admin
      .from("pdax_deposits")
      .select("family_wallet_id, status")
      .eq("identifier", identifier)
      .single();
    if (!existing) {
      return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
    }
    const e = existing as { family_wallet_id: string; status: string };
    const membership = await requireFamilyMember(e.family_wallet_id);
    if (membership instanceof NextResponse) return membership;
    return NextResponse.json({ ok: true, noChange: true, status: e.status });
  }

  const c = claimed[0] as { family_wallet_id: string };
  const membership = await requireFamilyMember(c.family_wallet_id);
  if (membership instanceof NextResponse) return membership;
  return NextResponse.json({ ok: true, status: "failed" });
}
