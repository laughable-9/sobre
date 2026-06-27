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
  /** Caller's smart-wallet C-address (`public.wallets.contract_id`). Surfaced
   *  here so routes that compare the caller against on-chain state don't
   *  need a second `wallets` SELECT after auth. */
  contractId: string;
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
    .select("id, contract_id")
    .eq("auth_id", authId)
    .single();
  if (!wallet) {
    return NextResponse.json(
      { error: "No smart wallet for this account" },
      { status: 404 },
    );
  }
  const w = wallet as { id: string; contract_id: string };
  return { memberId: w.id, contractId: w.contract_id, fullName };
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

/** Wider form of `requireFamilyMember`: admits both members AND sub-account
 *  holders of the given family. Use from routes that any participant can
 *  legitimately invoke — e.g. the sub-account's own PDAX cashout. */
export async function requireFamilyParticipant(
  familyWalletId: string,
): Promise<FamilyMemberContext | NextResponse> {
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const [memberRes, subRes] = await Promise.all([
    admin
      .from("family_members")
      .select("id")
      .eq("family_wallet_id", familyWalletId)
      .eq("wallet_id", ctx.memberId)
      .maybeSingle(),
    admin
      .from("family_subaccounts")
      .select("id")
      .eq("family_wallet_id", familyWalletId)
      .eq("wallet_id", ctx.memberId)
      .maybeSingle(),
  ]);
  if (!memberRes.data && !subRes.data) {
    return NextResponse.json(
      { error: "Not a member or sub-account of this family wallet" },
      { status: 403 },
    );
  }
  return ctx;
}

/** Tighter form of `requireFamilyMember` that also gates on the admin role.
 *  Use from routes that mutate family-scoped settings (e.g. /api/settings). */
export async function requireFamilyAdmin(
  familyWalletId: string,
): Promise<FamilyMemberContext | NextResponse> {
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const { data: membership } = await admin
    .from("family_members")
    .select("role")
    .eq("family_wallet_id", familyWalletId)
    .eq("wallet_id", ctx.memberId)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role !== "admin") {
    return NextResponse.json(
      { error: "Only the admin of this family can perform this action." },
      { status: 403 },
    );
  }
  return ctx;
}
