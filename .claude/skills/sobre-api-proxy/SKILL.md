---
name: sobre-api-proxy
description: Build and modify Sobre's server-side API proxy routes — Next.js 16 route handlers on Vercel (php-rate, and the planned MoneyGram/PDAX fiat on/off-ramp routes). Use when adding/editing anything under web/src/app/api/, proxying an external provider, or wiring SEP-10/24 auth.
---

# Sobre API Proxy Routes (Next.js route handlers)

Sobre has **no traditional backend and no database** — all app state lives in
Soroban contract storage. The only server code is thin proxy routes under
`web/src/app/api/`, deployed as Vercel edge/serverless functions. Their job:
keep secrets off the client, cache upstream responses, and translate provider
auth. The reference implementation is `web/src/app/api/php-rate/route.ts`.

Read `docs/pdax-moneygram-integration.md` in full before touching the
MoneyGram/PDAX work — it specifies the exact endpoints, auth, and limits.

## The pattern (follow php-rate/route.ts exactly)

```ts
export const runtime = "edge";   // or default node runtime if a Node-only dep is needed
export const revalidate = 600;   // server-side cache window, where applicable

export async function GET() {
  try {
    const res = await fetch(UPSTREAM_URL /*, { headers } */);
    if (!res.ok) return fallback();          // always have a graceful fallback
    const data = await res.json();
    // validate the shape before trusting it
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  } catch {
    return fallback();
  }
}
```

- **Browser never calls a provider directly.** Flow is always
  `Browser → /api/<provider> → provider`. The whole point is that credentials
  and signing keys stay server-side.
- **Validate upstream responses** before returning them (php-rate checks
  `typeof live === "number" && Number.isFinite(live) && live > 0`). Never pass
  an unvalidated provider body straight to the client.
- **Always provide a fallback** so a provider outage degrades gracefully rather
  than throwing (php-rate falls back to `PHP_PER_XLM` from config with a shorter
  cache window so it retries sooner).
- **Cache to respect rate limits.** Set `Cache-Control` `s-maxage` (edge) +
  `max-age` (browser). Caching one origin's request instead of N user-agents is
  how the free tiers stay under limit. Quotes: cache ~10s per the integration
  doc.

## Provider integration rules (MoneyGram / PDAX — when building these)

Target routes (names from the integration doc):
`/api/moneygram/transactions`, `/api/pdax/orders`, `/api/pdax/withdrawals`.

- **Secrets in Vercel env vars only.** OAuth client id/secret, the Sobre
  wallet SEP-10 keypair, PDAX API key/secret — never in the repo, never sent to
  the browser, never logged. Read via `process.env`.
- **MoneyGram auth is two layers:** OAuth 2.0 (Basic `base64(clientId:secret)`
  → access token) then SEP-10 (server signs MoneyGram's challenge with the
  **Sobre wallet keypair**, gets a session JWT) used as `Bearer` on SEP-24
  calls. Track **two JWT lifetimes**: the session JWT and the short-lived,
  single-use interactive-flow JWT embedded in the SEP-24 popup URL — generate
  the interactive one fresh per deposit attempt.
- **PDAX auth:** API key + secret (exact signing TBD on sandbox access).
- **Idempotency on writes.** Deposit-initiation and order-creation are
  non-idempotent — attach `Idempotency-Key: <uuid generated once per user
  action>` so a network retry doesn't double-execute.
- **Pass through `Retry-After`** on a provider 429 so the client backs off.
- **Versioning:** target a pinned provider API version; a breaking provider
  change should only require editing the proxy file, not the frontend.
- **Filtering/pagination upstream**, never pull-all-and-filter-in-memory
  (`?status=completed&sort=createdAt_desc&page=1&pageSize=20`).
- **SEP-24 hard requirements:** HTTPS only and `Access-Control-Allow-Origin: *`
  — enforced by MoneyGram, not optional.
- **stellar.toml:** MoneyGram requires a valid `stellar.toml` served at
  `/.well-known/stellar.toml` on the app domain — that's a route/static file to
  add before allowlisting.

## Logging (security-critical)

Log per request: timestamp, endpoint, HTTP status, latency ms, error code on
failure. **Never** log API keys, JWTs, stack traces, KYC/SEP-9 data, or any
user PII. Logs surface in Vercel's log drain. See the **sobre-security** skill.

## Quality gate

```bash
cd web
npx tsc --noEmit
npm run build     # route handlers are validated at build (runtime export, etc.)
```

Each proxy route file is the single source of truth for how Sobre calls that
provider — keep the OAuth/SEP-10/SEP-24 sequence documented in-file as
comments, the way php-rate documents its caching rationale.