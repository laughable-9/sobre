import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers. Reads/writes the session cookie through Next.js so server
 * code stays in sync with the browser's session state.
 *
 * Must be awaited. `cookies()` is async in Next.js 15+ and required here.
 *
 * Cookie writes silently no-op in Server Components (where setting cookies is
 * forbidden). Middleware refreshes the session on the next request, so the
 * stale cookie corrects itself within one round-trip.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Setting cookies from a Server Component throws — fine, middleware
          // re-issues on the next request.
        }
      },
    },
  });
}
