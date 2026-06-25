/**
 * Auth + family-wallet membership guard for /api/ route handlers. Folds the
 * 3-query check (Supabase session → wallet row → family_members row) into a
 * single helper so PDAX deposit / withdraw / future routes don't drift on
 * who can act on a family wallet.
 *
 * Returns `{memberId, fullName}` on success, or a `NextResponse` ready to
 * return (401/404/403) on failure. Route handlers do one `instanceof` check
 * and pass through.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface FamilyMemberContext {
  /** `public.wallets.id` for the signed-in user. */
  memberId: string;
  /** Auth user's display name (Google `full_name` → email → "Sobre User"). */
  fullName: string;
}

export async function requireFamilyMember(
  familyWalletId: string,
): Promise<FamilyMemberContext | NextResponse> {
  const sb = await createSupabaseServerClient();
  const { data: session } = await sb.auth.getSession();
  if (!session.session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authId = session.session.user.id;
  const fullName =
    session.session.user.user_metadata?.full_name ??
    session.session.user.email ??
    "Sobre User";

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
  const memberId = (wallet as { id: string }).id;

  const { data: membership } = await admin
    .from("family_members")
    .select("id")
    .eq("family_wallet_id", familyWalletId)
    .eq("wallet_id", memberId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: "Not a member of this family wallet" },
      { status: 403 },
    );
  }

  return { memberId, fullName };
}
