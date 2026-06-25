/**
 * POST /api/pdax/deposits/[identifier]/split
 *
 * Called by the deposit modal once the user-confirmed on-chain `deposit()`
 * lands and the family Sobre's envelopes have been auto-split. Marks the
 * row `status='split'` + records the tx hash so the dashboard timeline can
 * surface it.
 *
 * Auth: requires the caller to be a member of the family wallet the
 * deposit row belongs to. Service-role client used for the actual update
 * so RLS doesn't bite (we only set up SELECT for members).
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface RequestBody {
  split_tx_hash: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await ctx.params;
  if (!identifier || typeof identifier !== "string") {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body.split_tx_hash !== "string") {
    return NextResponse.json(
      { error: "Invalid body: expect { split_tx_hash }" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("pdax_deposits")
    .select("family_wallet_id, status")
    .eq("identifier", identifier)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }
  const familyWalletId = (row as { family_wallet_id: string }).family_wallet_id;

  const membership = await requireFamilyMember(familyWalletId);
  if (membership instanceof NextResponse) return membership;

  const { error: updateErr } = await admin
    .from("pdax_deposits")
    .update({ status: "split", split_tx_hash: body.split_tx_hash })
    .eq("identifier", identifier);
  if (updateErr) {
    return NextResponse.json(
      { error: `Update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
