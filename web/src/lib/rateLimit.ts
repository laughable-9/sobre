import "server-only";
import { NextResponse } from "next/server";

import { rateLimitBypassEmails } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface RateLimitParams {
  /** Slug for the counter row. Different call sites must not share slugs. */
  endpoint: string;
  /** wallets.id of the authenticated caller. */
  walletId: string;
  /** family_wallets.id the request is scoped to, or `null` for endpoints
   *  that don't have a family scope yet (e.g. /api/family/create runs
   *  before the wallet is a member of any family). When null, only the
   *  per-user cap is enforced; per-family is skipped. */
  familyWalletId: string | null;
  /** Caller email, from `WalletContext.email`. When it matches an entry in
   *  RATE_LIMIT_BYPASS_EMAILS the limit is skipped entirely. */
  callerEmail: string;
  /** Max calls per calendar day for the caller across every Sobre they're
   *  in. Enforced as a global-per-user cap. */
  perUser: number;
  /** Max calls per calendar day summed across every member of the family.
   *  Ignored when familyWalletId is null. */
  perFamily: number;
}

/**
 * Enforce a daily per-user + per-family cap on a route. Atomic: the RPC
 * bumps the counter under the row's lock and returns the fresh totals, so
 * two concurrent requests can't both see "just below the ceiling" and
 * simultaneously exceed it.
 *
 * Returns `null` when the request is under both ceilings (route continues)
 * or when the caller's email is on the bypass allowlist. Returns a
 * `NextResponse` with HTTP 429 when either limit is exceeded, so the
 * route short-circuits by `return`ing it.
 *
 * Day rollover is PH-local so the reset matches the user's actual day.
 */
/** Cached bypass Set. The env var is read-only at runtime; parse once. */
let bypassCache: Set<string> | null = null;
function bypassSet(): Set<string> {
  if (!bypassCache) bypassCache = rateLimitBypassEmails();
  return bypassCache;
}

export async function enforceDailyLimit(
  params: RateLimitParams,
): Promise<NextResponse | null> {
  // Dev / QA bypass. Emails come from RATE_LIMIT_BYPASS_EMAILS (server-only
  // env var). Empty allowlist in prod means no bypasses.
  const email = (params.callerEmail ?? "").toLowerCase();
  if (email && bypassSet().has(email)) {
    return null;
  }

  const admin = getSupabaseAdmin();
  const day = phLocalDay(new Date());
  // Sentinel used when the route doesn't have a family scope yet. All
  // per-wallet-only endpoints share this sentinel so their counters roll
  // over on the same day-boundary as scoped ones.
  const familyKey = params.familyWalletId ?? SENTINEL_FAMILY_ID;

  const { data, error } = await admin.rpc("usage_counter_bump", {
    p_wallet_id: params.walletId,
    p_family_wallet_id: familyKey,
    p_endpoint: params.endpoint,
    p_day: day,
  });
  if (error) {
    // Fail closed: if the counter can't be written, block. Better than
    // waving requests through and letting an attacker burn the quota.
    return NextResponse.json(
      { error: "Rate limit check failed. Try again shortly." },
      { status: 503 },
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const myCount = Number(row?.my_count ?? 0);
  const familyCount = Number(row?.family_count ?? 0);
  if (myCount > params.perUser) {
    return NextResponse.json(
      {
        error: `You've hit today's limit for this action (${params.perUser}/day). Try again tomorrow.`,
      },
      { status: 429 },
    );
  }
  if (params.familyWalletId && familyCount > params.perFamily) {
    return NextResponse.json(
      {
        error: `Your family has hit today's shared limit for this action (${params.perFamily}/day).`,
      },
      { status: 429 },
    );
  }
  return null;
}

/** Sentinel family id for per-wallet-only endpoints. Real families never use
 *  this UUID so its `family_wallet_id` FK check would fail — that's why the
 *  usage_counters table doesn't enforce that FK strictly for this shared
 *  bucket (see migration 07). */
const SENTINEL_FAMILY_ID = "00000000-0000-0000-0000-000000000000";

/** Return the PH-local calendar day (YYYY-MM-DD) for a JS Date. Sobre's
 *  users are all in PH so rolling over at Manila midnight matches their
 *  actual day. Hoisted formatter — construction is one of the more
 *  expensive stdlib primitives; reuse across every rate-limited request. */
const PH_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function phLocalDay(d: Date): string {
  const parts = PH_DAY_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}
