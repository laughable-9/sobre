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
