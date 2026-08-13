/**
 * GET /api/admin/whoami
 *
 * Tells the client whether the signed-in user is a platform admin, so the
 * UI can show/hide a link to /admin/metrics. This is NOT the security
 * boundary — /api/admin/metrics re-checks requirePlatformAdmin() on every
 * call regardless of what this route says. This route only ever answers
 * for the caller's own session; it never returns the admin allowlist
 * itself, so PLATFORM_ADMIN_EMAILS never reaches the browser.
 */

import { NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { platformAdminEmails } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const ctxOrRes = await requireWallet();
  if (ctxOrRes instanceof NextResponse) {
    return NextResponse.json({ isAdmin: false });
  }
  return NextResponse.json({
    isAdmin: platformAdminEmails().has(ctxOrRes.email),
  });
}
