/**
 * Auth helper for platform-wide admin routes (e.g. /api/admin/metrics).
 * Distinct from familyMember.ts's per-family gates — this checks the
 * caller's email against PLATFORM_ADMIN_EMAILS, not any on-chain or
 * family_members role.
 */

import "server-only";
import { NextResponse } from "next/server";

import { requireWallet, type WalletContext } from "@/lib/auth/familyMember";
import { platformAdminEmails } from "@/lib/env";

export async function requirePlatformAdmin(): Promise<
  WalletContext | NextResponse
> {
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;

  if (!platformAdminEmails().has(ctx.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return ctx;
}
