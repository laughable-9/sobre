/**
 * GET /api/pdax/deposits/active?contract_id=<C>
 *
 * Returns the signed-in member's non-terminal deposit rows for a family
 * wallet. Drives the dashboard's "pending deposits" surface so a user
 * who closed the modal mid-InstaPay can see and resume from the feed.
 *
 * Non-terminal = status in {pending, funded}. `credited` is terminal
 * now that the server invokes deposit_from_xlm atomically (2026-07-12
 * pivot) — envelopes are credited on-chain, no user-signed follow-up.
 * `split` and `failed` are terminal too.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN } from "@/lib/config";
import {
  getPdaxFiatTx,
  kickOffPdaxWithdraw,
  type PdaxFiatTransaction,
} from "@/lib/pdax/deposits";
import { mintClaim } from "@/lib/pdax/depositClaim";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json(
      { error: "Missing contract_id query param" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: familyRow } = await admin
    .from("family_wallets")
    .select("id")
    .eq("contract_id", contractId)
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

  // Client heartbeats this every 30s while the dashboard is open (~2880
  // ticks/day). Cap needs generous headroom or an idle tab 429s itself.
  const rate = await enforceDailyLimit({
    endpoint: "pdax_deposits_active",
    walletId: memberId,
    familyWalletId,
    callerEmail: ctx.email,
    perUser: 6000,
    perFamily: 12000,
  });
  if (rate) return rate;

  // GrabPay/PayMongo source URLs hard-expire; once they do, PDAX never
  // flips the corresponding /fiat/transactions row to COMPLETED and our
  // `pending` row sits in the bucket forever. Eagerly mark anything past
  // PENDING_TTL_MIN as failed before returning so the PENDING list stays
  // honest.
  //
  // PayMongo's documented source TTL is ~1 hour, but PDAX UAT sources
  // hit "expired" well before that in practice (~5-15 minutes in Kyle's
  // testing). Going conservative at 15 minutes: false-positive expires
  // can be re-initiated by the user with a single click and don't lose
  // funds (no money has moved at pending), so over-eager beats letting
  // an unusable URL sit in the feed.
  // Two staleness gates on top of poll-status: (1) a checkout that PDAX
  // never advanced (PayMongo source expired mid-InstaPay, ~15 min for UAT),
  // and (2) a funded row where the modal's poll-status loop is what
  // advances funded → credited via /crypto/transactions — if the user
  // closed the modal at funded and never returned, the row shows
  // "Buying XLM · tap to resume" forever. 60 min is well past PDAX UAT's
  // 2-10 min crypto-withdraw settlement; a real slow settle can still
  // reappear by resuming the modal (which drives it through poll-status
  // before this gate fires for it).
  await expireStaleDeposits(admin, familyWalletId, memberId, "pending", 15, "Checkout expired");
  // 4-hour TTL leaves ample runway for PDAX sandbox crypto withdraws
  // (10-40 min typical, occasionally longer). Paired with the
  // withdraw_tx_hash IS NULL guard inside expireStaleDeposits so
  // in-flight phase-2 rows are never touched.
  await expireStaleDeposits(admin, familyWalletId, memberId, "funded", 240, "Processing timed out");

  // Self-heal: PDAX's /fiat/transactions endpoint can lag the actual
  // settlement by a few seconds — the user may have paid via GrabPay,
  // gotten the confirmation email, but our /cancel pre-check found
  // nothing in PDAX's reporting API and let the cancel through. The
  // user's money is at PDAX but our row says "Cancelled by user".
  //
  // For every recently-cancelled row (within 5 minutes), re-check PDAX.
  // If they now show COMPLETED, atomically resurrect the row, run the
  // trade + crypto withdraw inline, and mark it `funded` so the modal /
  // activity feed pick it back up like any other deposit. The
  // PdaxDepositModal's resume affordance + poll-status loop will drive
  // it through to `credited` from there.
  await resurrectCancelledIfPaid(familyWalletId, memberId);

  const { data: rows, error } = await admin
    .from("pdax_deposits")
    .select(
      "identifier, amount_php, amount_usdc, payment_checkout_url, status, failure_reason, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .in("status", ["pending", "funded"])
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: `pdax_deposits read failed: ${error.message}` },
      { status: 500 },
    );
  }

  // Recently-failed deposits surface in the activity feed too — see the
  // matching block in /api/pdax/withdrawals/active for rationale.
  const RECENT_FAILED_LOOKBACK_DAYS = 7;
  const failedCutoff = new Date(
    Date.now() - RECENT_FAILED_LOOKBACK_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const { data: failedRows } = await admin
    .from("pdax_deposits")
    .select(
      "identifier, amount_php, amount_usdc, payment_checkout_url, status, failure_reason, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .eq("status", "failed")
    .gte("created_at", failedCutoff)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    deposits: rows ?? [],
    recentlyFailed: failedRows ?? [],
  });
}

/** Mark all deposit rows sitting in `status` past `ttlMin` minutes as failed
 *  with `failureReason`. Same query shape as PENDING_TTL_MIN gate; extracting
 *  keeps a future `credited` gate from becoming a third copy of the block.
 *
 *  For `funded` rows, only expire ones with `withdraw_tx_hash IS NULL` —
 *  otherwise phase-2 has either an in-flight claim or a landed
 *  deposit_from_xlm tx, and we shouldn't kill the row while the on-chain
 *  step is progressing. Without this guard, a PDAX crypto-withdraw leg
 *  taking longer than ttlMin (they can spike to 30-60 min on the
 *  sandbox) would fail a row whose XLM has actually landed at the relay.
 */
async function expireStaleDeposits(
  admin: ReturnType<typeof getSupabaseAdmin>,
  familyWalletId: string,
  memberId: string,
  status: "pending" | "funded" | "credited",
  ttlMin: number,
  failureReason: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - ttlMin * 60_000).toISOString();
  let q = admin
    .from("pdax_deposits")
    .update({ status: "failed", failure_reason: failureReason })
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .eq("status", status)
    .lt("created_at", cutoff);
  if (status === "funded") {
    q = q.is("withdraw_tx_hash", null);
  }
  await q;
}

/** Window in minutes after a row was marked "Cancelled by user" where
 *  we'll keep re-checking PDAX in case their reporting catches up. Beyond
 *  this the row stays terminal — the user can always start a fresh
 *  deposit and the cancelled row is just history at that point. */
const RESURRECT_WINDOW_MIN = 5;

async function resurrectCancelledIfPaid(
  familyWalletId: string,
  memberId: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const since = new Date(
    Date.now() - RESURRECT_WINDOW_MIN * 60_000,
  ).toISOString();
  const { data: candidates } = await admin
    .from("pdax_deposits")
    .select("identifier, amount_php")
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .eq("status", "failed")
    .eq("failure_reason", "Cancelled by user")
    .gte("created_at", since);
  if (!candidates?.length) return;

  // Re-check PDAX for each candidate in parallel. Most calls return
  // "no tx found" cheaply; the rare COMPLETED triggers the resurrect.
  await Promise.all(
    (candidates as Array<{ identifier: string; amount_php: number }>).map(
      (c) => resurrectOne(c.identifier, c.amount_php),
    ),
  );
}

async function resurrectOne(
  identifier: string,
  amountPhp: number,
): Promise<void> {
  const admin = getSupabaseAdmin();
  let tx: PdaxFiatTransaction | undefined;
  try {
    tx = await getPdaxFiatTx(identifier, "CashIn");
  } catch {
    // PDAX errored — try again on the next /active tick.
    return;
  }
  if (!tx || tx.status !== "COMPLETED") return;

  // Atomic resurrect + claim. Move status=failed → status=pending AND
  // stamp the claim sentinel in one update so a concurrent /active
  // tick or modal poll can't race in and double-fire the trade. The
  // claim carries an ISO timestamp so a handler that dies mid-trade
  // doesn't deadlock the row (see depositClaim.ts).
  const claim = mintClaim();
  const { data: claimed } = await admin
    .from("pdax_deposits")
    .update({
      status: "pending",
      failure_reason: null,
      withdraw_tx_hash: claim,
    })
    .eq("identifier", identifier)
    .eq("status", "failed")
    .eq("failure_reason", "Cancelled by user")
    .is("withdraw_tx_hash", null)
    .select("identifier");
  if (!claimed?.length) return;

  try {
    const { netAmount } = await kickOffPdaxWithdraw({
      identifier,
      amountPhp,
    });
    await admin
      .from("pdax_deposits")
      .update({
        status: "funded",
        // XLM at this stage, despite the column name: poll-status feeds
        // this into the Horizon incoming-payment match. Phase 2
        // overwrites it with the credited USDC when flipping to
        // `credited` — do not "fix" one side without the other.
        amount_usdc: netAmount,
        token_currency: PAYMENT_TOKEN,
        withdraw_tx_hash: null,
      })
      .eq("identifier", identifier)
      .eq("status", "pending")
      .eq("withdraw_tx_hash", claim);
  } catch (e) {
    // Trade failed — back out the claim. Row stays at status=pending so
    // the next /active tick or modal poll retries. Surfacing the actual
    // failure_reason here would be misleading (the original cancellation
    // is no longer the active reason), so we leave it null.
    console.error("[pdax /active resurrect]", e);
    await admin
      .from("pdax_deposits")
      .update({ withdraw_tx_hash: null })
      .eq("identifier", identifier)
      .eq("withdraw_tx_hash", claim);
  }
}
