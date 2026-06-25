/**
 * POST /api/pdax/deposits/[identifier]/simulate-complete
 *
 * Debug-only. Stand-in for the PDAX fiat webhook when PDAX can't reach
 * localhost (or while the user-facing payment page is IP-blocked on UAT).
 * Kicks off the PHP→token trade + crypto withdraw to the relay, marks
 * status `funded`, and returns immediately. The modal's 3s poll-status
 * loop drives the funded→credited transition (relay receives the token,
 * SAC transfer to the smart wallet, mark credited).
 *
 * Auth: requires family-wallet membership on the deposit's family.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { PAYMENT_TOKEN, PHP_PER_TOKEN_FALLBACK } from "@/lib/config";
import { pdaxEnv } from "@/lib/env";
import { pdaxErrorToResponse, PdaxError } from "@/lib/pdax/client";
import { kickOffPdaxWithdraw } from "@/lib/pdax/deposits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await ctx.params;
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("pdax_deposits")
    .select("family_wallet_id, member_id, amount_php, status")
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }

  const membership = await requireFamilyMember(
    (row as { family_wallet_id: string }).family_wallet_id,
  );
  if (membership instanceof NextResponse) return membership;

  // Idempotency: only the pending → funded transition is the simulate's
  // job. Anything past that and the poll-status loop is already driving.
  const currentStatus = (row as { status: string }).status;
  if (currentStatus !== "pending") {
    return NextResponse.json(
      { ok: true, status: currentStatus, noChange: true },
      { status: 200 },
    );
  }

  const amountPhp = (row as { amount_php: number }).amount_php;

  // In mock-mode just mark credited with a fake amount — no PDAX, no
  // relay, no on-chain transfer. The split step will fail because the
  // smart wallet has nothing to deposit; useful only for UI work.
  if (pdaxEnv().mock) {
    const amountToken = amountPhp / PHP_PER_TOKEN_FALLBACK[PAYMENT_TOKEN];
    await admin
      .from("pdax_deposits")
      .update({
        status: "credited",
        amount_usdc: amountToken,
        token_currency: PAYMENT_TOKEN,
        withdraw_tx_hash: "MOCK_TX_HASH",
      })
      .eq("identifier", identifier);
    return NextResponse.json({ ok: true, mock: true, amountToken });
  }

  // Real PDAX path. Kick off trade + withdraw to relay, mark funded, return
  // immediately. The modal's existing 3s poll-status loop drives the
  // funded→credited transition (relay receives, SAC-transfer, mark credited).
  try {
    const { amountToken, netAmount, pdaxWithdrawTxId } =
      await kickOffPdaxWithdraw({ identifier, amountPhp });

    await admin
      .from("pdax_deposits")
      .update({
        status: "funded",
        amount_usdc: netAmount,
        token_currency: PAYMENT_TOKEN,
      })
      .eq("identifier", identifier);

    return NextResponse.json({
      ok: true,
      status: "funded",
      amountToken,
      netAmount,
      currency: PAYMENT_TOKEN,
      pdaxWithdrawTxId,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await admin
      .from("pdax_deposits")
      .update({ status: "failed", failure_reason: reason })
      .eq("identifier", identifier);
    if (e instanceof PdaxError) {
      console.error("[pdax simulate-complete]", e.status, JSON.stringify(e.body));
    }
    return pdaxErrorToResponse(e, "PDAX simulate-complete failed");
  }
}
