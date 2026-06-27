/**
 * GET /api/pdax/withdrawals/active?contract_id=<C>
 *
 * Lists the signed-in member's non-terminal cashout rows for a family
 * wallet. Drives the dashboard's "Pending cashout" surface so a user
 * whose modal got closed (refresh, wifi blip, accidental dismiss in a
 * pre-locked phase) can still see where their money is and watch it
 * settle.
 *
 * Non-terminal = status ∈ {pending, spent, transferred, converted}.
 * Paid and failed are excluded — they're done.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Pending rows that have sat untouched for longer than this are hidden
 *  from the PENDING bucket. They stay in the DB but don't clutter the
 *  activity feed — either the user abandoned the modal before signing,
 *  or signing failed before any tx hash got recorded. If the row is
 *  actually recoverable (the spend tx DID land on chain), the modal's
 *  /api/pdax/withdrawals/recoverable check on mount will still find
 *  it via on-chain Spend events and surface the resume prompt. */
const PENDING_DISPLAY_TTL_MIN = 5;

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

  const { data: rows, error } = await admin
    .from("pdax_withdrawals")
    .select(
      "identifier, envelope, amount_usdc, amount_php, status, failure_reason, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    // Sub-account cashouts (envelope IS NULL) flow through their own
    // dashboard view via the row-realtime subscription; they should never
    // appear in the family-side active list, where their null envelope
    // would break renderers that assume a non-null name.
    .not("envelope", "is", null)
    .in("status", ["pending", "spent", "transferred", "converted", "processing"])
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: `pdax_withdrawals read failed: ${error.message}` },
      { status: 500 },
    );
  }

  // Drop stale pending rows from the response so abandoned cashouts
  // (user closed the modal before signing) don't sit in the activity
  // feed's PENDING bucket forever. Non-pending statuses always pass
  // through — once a spend tx has landed we want the row visible until
  // it settles either way.
  const staleCutoffMs = Date.now() - PENDING_DISPLAY_TTL_MIN * 60_000;
  const filtered = (rows ?? []).filter((r) => {
    const row = r as { status: string; created_at: string };
    if (row.status !== "pending") return true;
    return new Date(row.created_at).getTime() >= staleCutoffMs;
  });

  // Surface recently-completed cashouts (paid + failed). The activity
  // feed correlates these against on-chain Spend events with memo
  // "PDAX cashout" — for paid rows we append "Sent to <bank> ••••1461"
  // inline so the user sees where their money actually landed; for
  // failed rows we render a distinct warning entry. Without these,
  // successful cashouts read as generic envelope withdrawals (no bank
  // info) and failures vanish silently.
  const RECENT_LOOKBACK_DAYS = 7;
  const recentCutoff = new Date(
    Date.now() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const { data: terminalRows } = await admin
    .from("pdax_withdrawals")
    .select(
      "identifier, envelope, amount_usdc, amount_php, status, failure_reason, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    // Same isolation rationale as the active query above.
    .not("envelope", "is", null)
    .in("status", ["paid", "failed"])
    .gte("created_at", recentCutoff)
    .order("created_at", { ascending: false });

  const terminal = terminalRows ?? [];
  const failedRows = terminal.filter(
    (r) => (r as { status: string }).status === "failed",
  );
  const completedRows = terminal.filter(
    (r) => (r as { status: string }).status === "paid",
  );

  return NextResponse.json({
    cashouts: filtered,
    recentlyFailed: failedRows,
    recentlyCompleted: completedRows,
  });
}
