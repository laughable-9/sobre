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

import { requireFamilyParticipant } from "@/lib/auth/familyMember";
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
  // Read first + auth-gate BEFORE the atomic flip. The earlier version
  // mutated the row and ran requireFamilyMember on the result, which
  // let anyone who learned the identifier (shared screen, log leak)
  // poison the row to `spent` with attacker-supplied tx hashes and
  // receive a 401 — the row was already wrecked by the time the auth
  // check ran. Now: row lookup → membership check → atomic flip.
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
  const ex = existing as { family_wallet_id: string; status: string };
  // Either a member OR the sub-account holder can confirm their own
  // cashout — family_wallet_id gates by family, and the row's member_id
  // (set at /fiat/withdraw insert time) is the on-chain spender either way.
  const membership = await requireFamilyParticipant(ex.family_wallet_id);
  if (membership instanceof NextResponse) return membership;

  // Now safe to mutate. Atomic claim still guards against double-fires:
  // a row past 'pending' returns 0 rows and we surface its current
  // status as noChange.
  const { data: claimed, error: updateErr } = await admin
    .from("pdax_withdrawals")
    .update({
      status: "spent",
      spend_tx_hash: body.spend_tx_hash,
      forward_tx_hash: body.forward_tx_hash,
    })
    .eq("identifier", identifier)
    .eq("status", "pending")
    .select("identifier");
  if (updateErr) {
    return NextResponse.json(
      { error: `pdax_withdrawals update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  if (!claimed?.length) {
    return NextResponse.json({ ok: true, noChange: true, status: ex.status });
  }

  return NextResponse.json({ ok: true, status: "spent" });
}
