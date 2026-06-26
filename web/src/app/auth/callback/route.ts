import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Google redirects the browser here after the user picks an
 * account and approves scopes. We exchange the short-lived `code` query
 * param for a Supabase session (set as httpOnly cookies), then redirect to
 * wherever the flow started.
 *
 * `next` lets the caller pin the post-login destination — useful when the
 * sign-in originated from `/invite/[code]` and should return there.
 */
/** Only accept same-origin relative paths. Rejects protocol-relative
 *  values like `//evil.com/phish` (which `new URL(next, origin)` would
 *  otherwise resolve to https://evil.com/phish, letting an attacker
 *  steer the user off-site after Google OAuth completes — a passkey
 *  phishing vector). */
function safeNext(raw: string | null): string {
  if (!raw) return "/signup";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/signup";
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/signup?auth_error=${encodeURIComponent(error.message)}`, url.origin),
      );
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
