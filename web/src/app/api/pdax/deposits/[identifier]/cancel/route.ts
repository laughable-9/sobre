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
import { enforceDailyLimit } from "@/lib/rateLimit";
import { PdaxError } from "@/lib/pdax/client";
import { getPdaxFiatTx } from "@/lib/pdax/deposits";
import { isFreshClaim } from "@/lib/pdax/depositClaim";
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

  // Read the row FIRST so we can enforce membership + rate limit BEFORE
  // touching PDAX. Reordered from the previous version, which called
  // getPdaxFiatTx on an unauthenticated caller — that let anyone with a
  // leaked identifier distinguish "already paid" (409) from other
  // statuses (401) via error shape and burn PDAX API quota without ever
  // passing our rate-limit gate.
  const { data: row } = await admin
    .from("pdax_deposits")
    .select("family_wallet_id, status, withdraw_tx_hash")
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }
  const r = row as {
    family_wallet_id: string;
    status: string;
    withdraw_tx_hash: string | null;
  };
  const membership = await requireFamilyMember(r.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  const rate = await enforceDailyLimit({
    endpoint: "pdax_deposit_cancel",
    walletId: membership.memberId,
    familyWalletId: r.family_wallet_id,
    callerEmail: membership.email,
    perUser: 30,
    perFamily: 60,
  });
  if (rate) return rate;

  // Pre-check: did PDAX already receive the PHP? If so, we MUST NOT
  // cancel — doing so leaves the institution balance with money the
  // user paid for but our pipeline never converts to XLM. Returns 409
  // so the client can show a "Already paid, completing your deposit"
  // toast and let poll-status take over.
  //
  // Only relevant for status='pending'. funded/credited mean we've
  // already moved money in our system, and PDAX is no longer the
  // source of truth for "was this paid".
  if (r.status === "pending") {
    try {
      const tx = await getPdaxFiatTx(identifier, "CashIn");
      if (tx && tx.status === "COMPLETED") {
        return NextResponse.json(
          {
            error: "Payment already received. Cancel refused.",
            code: "already_paid",
          },
          { status: 409 },
        );
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
  }

  if (r.status !== "pending") {
    return NextResponse.json({ ok: true, noChange: true, status: r.status });
  }
  if (isFreshClaim(r.withdraw_tx_hash)) {
    return NextResponse.json({ ok: true, noChange: true, status: r.status });
  }

  // Atomic CAS on whatever withdraw_tx_hash currently holds (NULL OR a
  // stale claim) so a fresh claim acquired between our read and update
  // wins the race. Supabase's `.eq` doesn't match NULLs — use `.is`
  // when the read returned NULL.
  let cancelQuery = admin
    .from("pdax_deposits")
    .update({
      status: "failed",
      failure_reason: "Cancelled by user",
    })
    .eq("identifier", identifier)
    .eq("status", "pending");
  cancelQuery =
    r.withdraw_tx_hash === null
      ? cancelQuery.is("withdraw_tx_hash", null)
      : cancelQuery.eq("withdraw_tx_hash", r.withdraw_tx_hash);
  const { data: claimed, error } = await cancelQuery.select("identifier");
  if (error) {
    return NextResponse.json(
      { error: `pdax_deposits update failed: ${error.message}` },
      { status: 500 },
    );
  }
  if (!claimed?.length) {
    // Lost the race — a fresh claim was acquired between our read and
    // update. Treat as noChange.
    return NextResponse.json({ ok: true, noChange: true, status: r.status });
  }
  return NextResponse.json({ ok: true, status: "failed" });
}
