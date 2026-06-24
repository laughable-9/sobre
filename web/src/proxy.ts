import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every page request. Without this,
 * an expired access token stays expired in the browser until the user does
 * something that calls supabase.auth — leading to flaky "logged out" states
 * in Server Components that ran before the refresh fired.
 *
 * Lives at src/proxy.ts because Next.js 16 renamed the `middleware` file
 * convention to `proxy`. The export must be named `proxy`, not `middleware`.
 *
 * The matcher below skips static assets and Next.js internals; no point
 * refreshing the session when the user is just loading a logo.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Side effect only — getUser() triggers the refresh if the token expired.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Skip:
     *  - _next/static, _next/image (build assets)
     *  - favicon.ico, image extensions (static assets)
     *  - /api/* (route handlers manage their own session)
     */
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
