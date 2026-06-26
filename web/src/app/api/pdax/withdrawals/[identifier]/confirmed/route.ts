/**
 * POST /api/pdax/withdrawals/[identifier]/confirmed
 *
 * Called by the modal after both user-signed Stellar ops land:
 *   spend()                            — XLM envelope → user smart wallet
 *   SAC transfer(user → relay)         — XLM smart wallet → relay G-address
 *
 * Body: { spend_tx_hash, forward_tx_hash }
 *
 * Atomically flips status `pending` → `spent` so the poll-status route takes
 * over from here. We don't re-verify the on-chain ops here — the poll-status
 * route verifies the relay's balance changed by the expected amount before
 * submitting the outbound classic payment to PDAX. Cheaper than parsing
 * Soroban event logs and the side-effect that matters (XLM at relay) is
 * directly observable.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface RequestBody {
  spend_tx_hash: string;
  forward_tx_hash: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await ctx.params;
  if (!identifier) {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (
    !body ||
    typeof body.spend_tx_hash !== "string" ||
    typeof body.forward_tx_hash !== "string"
  ) {
    return NextResponse.json(
      { error: "Invalid body: expect { spend_tx_hash, forward_tx_hash }" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  // Single atomic claim: flip pending→spent and stamp both tx hashes in one
  // round-trip. RETURNING family_wallet_id lets us verify membership after
  // the fact rather than reading the row up-front, saving one query per
  // /confirmed call. A row that's already past 'pending' returns 0 rows
  // here — we then read the existing status for an informative response.
  const { data: claimed, error: updateErr } = await admin
    .from("pdax_withdrawals")
    .update({
      status: "spent",
      spend_tx_hash: body.spend_tx_hash,
      forward_tx_hash: body.forward_tx_hash,
    })
    .eq("identifier", identifier)
    .eq("status", "pending")
    .select("family_wallet_id");
  if (updateErr) {
    return NextResponse.json(
      { error: `pdax_withdrawals update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  if (!claimed?.length) {
    // Either the row doesn't exist, or its status has already advanced
    // past 'pending'. Disambiguate so a 404 surfaces correctly and a stale
    // /confirmed retry returns ok-noChange.
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
    return NextResponse.json({ ok: true, noChange: true, status: e.status });
  }

  const c = claimed[0] as { family_wallet_id: string };
  const membership = await requireFamilyMember(c.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  return NextResponse.json({ ok: true, status: "spent" });
}
