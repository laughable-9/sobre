/**
 * POST / GET / DELETE /api/expense-logs
 *
 * Off-chain expense notes — the "What did you spend on?" quick-log. These are
 * record-only: they move no funds and are NOT on-chain spends. Saving is
 * immediate (one INSERT); the client offers a short undo window that calls
 * DELETE to remove the just-created row.
 *
 * Auth: caller must be a member of the family wallet the note belongs to
 * (requireFamilyMember). Writes use the service-role client after that check,
 * mirroring the member/bank + family/create routes. DELETE additionally
 * restricts to the row's own author so one member can't delete another's log.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_NOTE_LEN = 200;

interface PostBody {
  family_wallet_id: string;
  note: string;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

// ── GET: recent notes for a family (dashboard list) ────────────────────────
export async function GET(req: Request) {
  const familyWalletId = new URL(req.url).searchParams.get("family_wallet_id");
  if (!isUuid(familyWalletId)) {
    return NextResponse.json(
      { error: "family_wallet_id (uuid) is required" },
      { status: 400 },
    );
  }

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("expense_logs")
    .select("id, note, created_at, wallet_id")
    .eq("family_wallet_id", familyWalletId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data ?? [] });
}

// ── POST: log a note (saves immediately) ───────────────────────────────────
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body || !isUuid(body.family_wallet_id) || typeof body.note !== "string") {
    return NextResponse.json(
      { error: "Invalid body: expect { family_wallet_id (uuid), note }" },
      { status: 400 },
    );
  }
  const note = body.note.trim();
  if (note.length === 0 || note.length > MAX_NOTE_LEN) {
    return NextResponse.json(
      { error: `note must be 1–${MAX_NOTE_LEN} characters` },
      { status: 400 },
    );
  }

  const ctx = await requireFamilyMember(body.family_wallet_id);
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("expense_logs")
    .insert({
      family_wallet_id: body.family_wallet_id,
      wallet_id: ctx.memberId,
      note,
    })
    .select("id, note, created_at, wallet_id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ log: data });
}

// ── DELETE: undo — remove a note the caller authored ───────────────────────
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const familyWalletId = url.searchParams.get("family_wallet_id");
  if (!isUuid(id) || !isUuid(familyWalletId)) {
    return NextResponse.json(
      { error: "id and family_wallet_id (uuid) are required" },
      { status: 400 },
    );
  }

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  // Scope the delete to (id, family, author) so a member can only undo their
  // own note, and only within the family they belong to.
  const { error } = await admin
    .from("expense_logs")
    .delete()
    .eq("id", id)
    .eq("family_wallet_id", familyWalletId)
    .eq("wallet_id", ctx.memberId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
