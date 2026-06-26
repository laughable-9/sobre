/**
 * POST /api/pdax/withdrawals/[identifier]/simulate-credit
 *
 * Dev shortcut: flip a `spent` cashout row to `transferred` without waiting
 * for PDAX UAT to credit the relay's classic XLM payment to the institution
 * balance.
 *
 * Why it exists: PDAX UAT's `/crypto/transactions?type=crypto_in` returns
 * empty for inbound deposits even after the on-chain payment to their
 * deposit address has settled with the correct memo_id. We've verified
 * the relay tx lands on Horizon successfully (memo + address + amount all
 * match), but PDAX never surfaces the credit signal — so poll-status is
 * blocked at the spent→transferred boundary indefinitely.
 *
 * The sell-trade + fiat-withdraw legs that follow this flip don't actually
 * need the inbound XLM to land first — PDAX UAT was pre-funded with ~10k
 * XLM and our cashout amounts (sub-1k XLM) sit comfortably under that. So
 * the trade succeeds against the existing balance and the PHP payout fires,
 * giving us an end-to-end demo while we wait on PDAX support to fix the
 * inbound-credit accounting.
 *
 * NOT a production path. Remove or gate behind a feature flag before
 * shipping cashout to mainnet.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
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
  // Single atomic claim, mirror of /confirmed — flip spent→transferred and
  // return family_wallet_id for the membership check after the fact.
  const { data: claimed, error: updateErr } = await admin
    .from("pdax_withdrawals")
    .update({ status: "transferred" })
    .eq("identifier", identifier)
    .eq("status", "spent")
    .select("family_wallet_id");
  if (updateErr) {
    return NextResponse.json(
      { error: `update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  if (!claimed?.length) {
    const { data: existing } = await admin
      .from("pdax_withdrawals")
      .select("family_wallet_id, status")
      .eq("identifier", identifier)
      .single();
    if (!existing) {
      return NextResponse.json(
        { error: "Withdrawal not found" },
        { status: 404 },
      );
    }
    const e = existing as { family_wallet_id: string; status: string };
    const membership = await requireFamilyMember(e.family_wallet_id);
    if (membership instanceof NextResponse) return membership;
    return NextResponse.json({
      ok: true,
      noChange: true,
      status: e.status,
      note: "simulate-credit is only valid when status='spent'",
    });
  }

  const c = claimed[0] as { family_wallet_id: string };
  const membership = await requireFamilyMember(c.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  return NextResponse.json({ ok: true, status: "transferred" });
}
