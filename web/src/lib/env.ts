/**
 * Validated env-var module. One place to add a new `NEXT_PUBLIC_*` key, one
 * place that throws if it's missing. Consumers import the named constant
 * instead of repeating `process.env.X ?? throw "missing"` everywhere.
 *
 * The literal `process.env.NEXT_PUBLIC_FOO` accesses below are NOT dynamic —
 * Next.js's bundler statically replaces them with the build-time value so
 * the constants land in the client bundle. Replacing them with
 * `process.env[someVar]` would break that inlining; don't.
 *
 * Validation runs at module load: a missing env var crashes the importing
 * code with a clear message instead of leaking `undefined` deeper into the
 * stack. Fine for our hackathon-scope app where fail-fast beats degraded.
 */

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `[env] missing ${name} — copy web/.env.example to web/.env.local`,
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
);

export const SUPABASE_ANON_KEY = required(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

/** Server-only service-role key. Bypasses RLS — only use from API routes
 *  for system writes (PDAX webhook updates, cron jobs). Deferred validation
 *  via getter so the rest of the app boots without it. */
export function supabaseServiceRoleKey(): string {
  return required(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
}

/**
 * PDAX institutional credentials (server-only — never `NEXT_PUBLIC_`).
 * Sobre is the single PDAX customer; users never see PDAX directly. We fan
 * out per-user deposits/withdrawals against the same institution account
 * using a UUIDv4 `identifier` per request.
 *
 * Defer the validation by exposing the vars via getters so dev environments
 * without PDAX configured can still boot — only the routes that actually
 * touch PDAX will throw on missing.
 */
export function pdaxEnv() {
  return {
    baseUrl:
      process.env.PDAX_BASE_URL ||
      "https://uat.services.sandbox.pdax.ph/api/pdax-api",
    username: required(process.env.PDAX_USERNAME, "PDAX_USERNAME"),
    password: required(process.env.PDAX_PASSWORD, "PDAX_PASSWORD"),
    /** When true, all PDAX routes return canned mock responses without
     *  contacting PDAX. Useful while UAT credentials are arriving or for
     *  E2E tests where we want determinism. */
    mock: process.env.MOCK_PDAX === "true",
    /** Shared secret PDAX passes back as `?key=...` on the webhook URL we
     *  register. PDAX doesn't sign webhook payloads, so the secret in the
     *  URL is our only auth signal. */
    webhookSecret: process.env.PDAX_WEBHOOK_SECRET,
  };
}
