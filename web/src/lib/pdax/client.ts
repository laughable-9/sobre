/**
 * Server-side PDAX institutional client. Holds the access/id/refresh token
 * triplet in module-level memory, refreshes on demand, and exposes a single
 * `pdaxFetch()` that every route can use without re-implementing auth.
 *
 * NEVER import this from a "use client" file — the credentials would leak
 * into the browser bundle. The /api/pdax/* routes are the only consumers.
 *
 * Token TTLs (from PDAX docs):
 *   - access_token / id_token: 600 seconds
 *   - refresh_token: 30 days
 * We refresh 60 seconds early to absorb clock skew + request latency.
 */

import "server-only";

import { NextResponse } from "next/server";

import { pdaxEnv } from "@/lib/env";

interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** Epoch ms when access_token expires. */
  expiresAtMs: number;
}

let cached: TokenSet | null = null;
let inflight: Promise<TokenSet> | null = null;

const ACCESS_TTL_SAFETY_MS = 60_000;

function now(): number {
  return Date.now();
}

function isFresh(t: TokenSet): boolean {
  return t.expiresAtMs - now() > ACCESS_TTL_SAFETY_MS;
}

interface LoginResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expiry?: number;
}

interface RefreshResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expiry?: number;
}

interface ChallengeResponse {
  code: "AuthChallengeRequired";
  challenge_name: "SOFTWARE_TOKEN_MFA" | string;
  session: string;
  message?: string;
}

function isChallenge(body: unknown): body is ChallengeResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "AuthChallengeRequired"
  );
}

function tokenSetFrom(body: LoginResponse | RefreshResponse): TokenSet {
  const ttlSec = body.expiry ?? 600;
  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAtMs: now() + ttlSec * 1000,
  };
}

async function jsonRequest<T>(
  method: "POST" | "PUT",
  url: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new PdaxError(
      res.status,
      parsed,
      `${method} ${url} failed: ${res.status}`,
    );
  }
  return parsed as T;
}

async function login(): Promise<TokenSet> {
  const env = pdaxEnv();
  const initial = await jsonRequest<LoginResponse | ChallengeResponse>(
    "POST",
    `${env.baseUrl}/pdax-institution/v1/login`,
    { username: env.username, password: env.password },
  );

  if (isChallenge(initial)) {
    // The hackathon account has no MFA enrolled; a challenge here means the
    // account state changed underneath us. Bail rather than carry ~40 lines
    // of TOTP machinery for a path we don't exercise.
    throw new Error(
      "PDAX returned an MFA challenge. The institution account is expected " +
        "to be MFA-disabled for the demo — re-check the account state in the " +
        "PDAX portal.",
    );
  }

  return tokenSetFrom(initial);
}

async function refresh(t: TokenSet): Promise<TokenSet> {
  const env = pdaxEnv();
  const body = await jsonRequest<RefreshResponse>(
    "PUT",
    `${env.baseUrl}/pdax-institution/v1/refresh-token`,
    { username: env.username, refreshToken: t.refreshToken },
  );
  return tokenSetFrom(body);
}

/** Get a valid TokenSet — login on first call, refresh when stale, return
 *  cached otherwise. Concurrent calls dedupe on the inflight promise. */
async function getTokens(): Promise<TokenSet> {
  if (cached && isFresh(cached)) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const next = cached ? await refresh(cached).catch(() => login()) : await login();
      cached = next;
      return next;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export class PdaxError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "PdaxError";
  }
}

/**
 * Standard "PDAX rejected, surface it to the client" shape. Returns
 * `{ error: "PDAX: <message>", pdax: <raw body> }` with status 502 when
 * the error is a PdaxError, or 500 for anything else. Use this from any
 * route that calls `pdaxFetch` so error rendering stays consistent.
 */
export function pdaxErrorToResponse(
  e: unknown,
  fallback: string,
): NextResponse {
  if (e instanceof PdaxError) {
    return NextResponse.json(
      {
        error:
          typeof e.body === "object" && e.body !== null && "message" in e.body
            ? `PDAX: ${(e.body as { message: string }).message}`
            : fallback,
        pdax: e.body,
      },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: e instanceof Error ? e.message : String(e) },
    { status: 500 },
  );
}

export type PdaxMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface PdaxFetchOptions {
  method?: PdaxMethod;
  /** JSON body for the request. */
  body?: unknown;
  /** Query params appended to the URL. Skipped when value is undefined. */
  query?: Record<string, string | number | undefined>;
}

/**
 * Call any authenticated PDAX endpoint. Returns the parsed JSON body; throws
 * `PdaxError` on non-2xx. Pass the path *relative to the base URL* —
 * e.g. `/pdax-institution/v1/balances`.
 */
export async function pdaxFetch<T>(
  path: string,
  opts: PdaxFetchOptions = {},
): Promise<T> {
  const env = pdaxEnv();
  const tokens = await getTokens();

  const url = new URL(env.baseUrl + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      access_token: tokens.accessToken,
      id_token: tokens.idToken,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    // Surface PDAX's own error fields in the Error.message so the
    // failure_reason column + UI strings carry the actual diagnostic
    // ("Invalid Quantity Step", "sender_middle_name is required") instead
    // of just the bare HTTP status. PDAX's shape isn't consistent across
    // endpoints — /trade returns {code, message}, /fiat/withdraw returns
    // {error} — so we read all three and concatenate whatever's present.
    const obj =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    const pdaxCode = obj && "code" in obj ? String(obj.code) : null;
    const pdaxMsg = obj && "message" in obj ? String(obj.message) : null;
    const pdaxErr = obj && "error" in obj ? String(obj.error) : null;
    const parts = [pdaxCode, pdaxMsg && `"${pdaxMsg}"`, pdaxErr && `"${pdaxErr}"`]
      .filter(Boolean)
      .join(" ");
    const detail = parts ? ` ${parts}` : "";
    throw new PdaxError(
      res.status,
      parsed,
      `PDAX ${opts.method ?? "GET"} ${path} → ${res.status}${detail}`,
    );
  }
  return parsed as T;
}

/** Force-clear the cached tokens. Useful for testing or when PDAX rotates
 *  credentials and the cached refresh_token is no longer valid. */
export function resetPdaxTokens(): void {
  cached = null;
  inflight = null;
}
