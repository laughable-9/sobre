/**
 * GET / POST / DELETE /api/settings/pending
 *
 * Pattern A: admin's intended on-chain settings change, staged in Supabase
 * until committed via an `apply_settings(...)` tx. Latest save wins (single
 * row per family). When the admin's `commitPending` tx lands, the client
 * DELETEs the row to clear the pending pill.
 *
 * Auth: any family member can GET; only the admin can POST/DELETE.
 */

import { NextResponse } from "next/server";

import { requireFamilyAdmin, requireWallet } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface PostBody {
  family_wallet_id: string;
  /** Optional new envelope percentages (sum must be 100). */
  percents?: [number, number, number];
  /** Optional new SpendPolicy (includes per_tx_threshold, daily_limit, etc.). */
  policy_json?: {
    require_all_sigs: boolean;
    daily_limit: string | null;
    per_tx_threshold: string | null;
    protected_envelopes: ("Groceries" | "Tuition" | "Savings")[];
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familyWalletId = url.searchParams.get("family_wallet_id");
  if (!familyWalletId) {
    return NextResponse.json(
      { error: "Missing family_wallet_id query param" },
      { status: 400 },
    );
  }
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;
  const admin = getSupabaseAdmin();
  const { data: membership } = await admin
    .from("family_members")
    .select("id")
    .eq("family_wallet_id", familyWalletId)
    .eq("wallet_id", ctx.memberId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: "Not a member of this family." },
      { status: 403 },
    );
  }
  const { data: row } = await admin
    .from("pending_settings")
    .select("*")
    .eq("family_wallet_id", familyWalletId)
    .maybeSingle();
  return NextResponse.json({ pending: row ?? null });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body || typeof body.family_wallet_id !== "string") {
    return NextResponse.json(
      { error: "Invalid body: expected { family_wallet_id, ... }" },
      { status: 400 },
    );
  }

  const ctx = await requireFamilyAdmin(body.family_wallet_id);
  if (ctx instanceof NextResponse) return ctx;

  if (body.percents === undefined && body.policy_json === undefined) {
    return NextResponse.json(
      { error: "Empty update — pass at least one of percents, policy_json." },
      { status: 400 },
    );
  }
  if (
    body.percents &&
    (body.percents.length !== 3 ||
      body.percents.reduce((a, b) => a + b, 0) !== 100)
  ) {
    return NextResponse.json(
      { error: "percents must be three integers summing to 100." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: row, error: upsertErr } = await admin
    .from("pending_settings")
    .upsert(
      {
        family_wallet_id: body.family_wallet_id,
        percents: body.percents ?? null,
        policy_json: body.policy_json ?? null,
        intended_at: new Date().toISOString(),
      },
      { onConflict: "family_wallet_id" },
    )
    .select("*")
    .single();

  if (upsertErr) {
    return NextResponse.json(
      { error: `pending_settings upsert failed: ${upsertErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ pending: row });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const familyWalletId = url.searchParams.get("family_wallet_id");
  if (!familyWalletId) {
    return NextResponse.json(
      { error: "Missing family_wallet_id query param" },
      { status: 400 },
    );
  }
  const ctx = await requireFamilyAdmin(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const { error: deleteErr } = await admin
    .from("pending_settings")
    .delete()
    .eq("family_wallet_id", familyWalletId);
  if (deleteErr) {
    return NextResponse.json(
      { error: `pending_settings delete failed: ${deleteErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
