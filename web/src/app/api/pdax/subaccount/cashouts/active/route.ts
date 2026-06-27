/**
 * GET /api/pdax/subaccount/cashouts/active
 *
 * Per-caller list of in-flight + recently-terminal sub-account cashouts.
 * Mirror of /api/pdax/withdrawals/active but scoped to the calling
 * sub-account holder (member_id = caller wallets.id AND subaccount_id IS
 * NOT NULL). The family-side /active route hides these via its
 * envelope-IS-NOT-NULL filter; the sub view fetches them here so a JR-side
 * cashout that's mid-pipeline surfaces as a PENDING strip with tap-to-resume,
 * matching the family activity feed's affordance.
 */

import { NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PENDING_DISPLAY_TTL_MIN = 30;
const RECENT_LOOKBACK_DAYS = 7;

interface CashoutRow {
  identifier: string;
  amount_usdc: number;
  amount_php: number | null;
  status: string;
  failure_reason: string | null;
  beneficiary_bank_code: string;
  beneficiary_account_name: string;
  beneficiary_account_number: string;
  created_at: string;
}

export async function GET() {
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;
  const { memberId } = ctx;

  const admin = getSupabaseAdmin();

  // Run active + recent terminal in parallel — each one round-trip;
  // sequential adds ~50-100ms of pure round-trip overhead for no
  // ordering reason.
  const recentCutoff = new Date(
    Date.now() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const COLUMNS =
    "identifier, amount_usdc, amount_php, status, failure_reason, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, created_at";
  const [activeRes, terminalRes] = await Promise.all([
    admin
      .from("pdax_withdrawals")
      .select(COLUMNS)
      .eq("member_id", memberId)
      .not("subaccount_id", "is", null)
      .in("status", ["pending", "spent", "transferred", "converted", "processing"])
      .order("created_at", { ascending: false }),
    admin
      .from("pdax_withdrawals")
      .select(COLUMNS)
      .eq("member_id", memberId)
      .not("subaccount_id", "is", null)
      .in("status", ["paid", "failed"])
      .gte("created_at", recentCutoff)
      .order("created_at", { ascending: false }),
  ]);
  if (activeRes.error) {
    return NextResponse.json(
      { error: `pdax_withdrawals read failed: ${activeRes.error.message}` },
      { status: 500 },
    );
  }

  // Drop stale pending rows so abandoned cashouts (modal closed before
  // signing) don't sit forever — same TTL as the family-side route.
  const staleCutoffMs = Date.now() - PENDING_DISPLAY_TTL_MIN * 60_000;
  const active = ((activeRes.data as CashoutRow[] | null) ?? []).filter(
    (r) => {
      if (r.status !== "pending") return true;
      return new Date(r.created_at).getTime() >= staleCutoffMs;
    },
  );

  return NextResponse.json({
    active,
    terminal: terminalRes.data ?? [],
  });
}
