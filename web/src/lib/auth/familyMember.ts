/**
 * Auth helpers for /api/ route handlers.
 *
 * - `requireWallet`: the first half — session → wallet row. Used by routes
 *   that act on per-member state (e.g. /api/member/bank).
 * - `requireFamilyMember`: builds on top, adds the family_members membership
 *   check. Used by all PDAX deposit / withdraw routes.
 *
 * Returns the context on success, or a `NextResponse` ready to return on
 * failure. Route handlers do one `instanceof` check and pass through.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface WalletContext {
  /** `public.wallets.id` for the signed-in user. */
  memberId: string;
  /** Auth user's display name (Google `full_name` → email → "Sobre User"). */
  fullName: string;
}

export type FamilyMemberContext = WalletContext;

export async function requireWallet(): Promise<WalletContext | NextResponse> {
  const sb = await createSupabaseServerClient();
  // getUser hits the Supabase auth server to verify the JWT — getSession just
  // reads the cookie, which Supabase warns is insecure. Cost is one extra
  // network round-trip; benefit is no "Using the user object as returned
  // from supabase.auth.getSession() ... could be insecure" log spam on the
  // poll-status routes that hit this every few seconds.
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authId = data.user.id;
  const fullName =
    data.user.user_metadata?.full_name ?? data.user.email ?? "Sobre User";

  const admin = getSupabaseAdmin();
  const { data: wallet } = await admin
    .from("wallets")
    .select("id")
    .eq("auth_id", authId)
    .single();
  if (!wallet) {
    return NextResponse.json(
      { error: "No smart wallet for this account" },
      { status: 404 },
    );
  }
  return { memberId: (wallet as { id: string }).id, fullName };
}

export async function requireFamilyMember(
  familyWalletId: string,
): Promise<FamilyMemberContext | NextResponse> {
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
      { error: "Not a member of this family wallet" },
      { status: 403 },
    );
  }
  return ctx;
}
