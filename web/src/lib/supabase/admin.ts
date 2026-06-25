import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL, supabaseServiceRoleKey } from "@/lib/env";

/**
 * Service-role Supabase client. Bypasses RLS — only call from API routes
 * for system-driven writes (PDAX webhook updates, etc). Browser code MUST
 * NOT import this; the key must never leak into the client bundle.
 *
 * Lazy-instantiated so the rest of the app can boot without the env var
 * configured. Only the first call into a /api/pdax/* route that hits Supabase
 * will throw if the key is missing.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!cached) {
    cached = createClient(SUPABASE_URL, supabaseServiceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return cached;
}
