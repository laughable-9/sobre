/**
 * Server-side rate proxy. Fetches XLM/PHP from CoinGecko once per ISR window
 * and serves the cached result to every browser client, so CoinGecko sees one
 * origin (this server) instead of N user-agents and we stay under their free
 * tier rate limit at any user count.
 *
 * The fallback rate matches lib/config.ts so clients still get a sane number
 * if CoinGecko is unreachable when the cache needs to refresh.
 */

import { NextResponse } from "next/server";

export const runtime = "edge";
// 10-minute server cache. Vercel serves the same response to every client
// hitting the route within this window from the edge.
export const revalidate = 600;

const FALLBACK_RATE = 16;

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=php";

interface CoingeckoResponse {
  stellar?: { php?: number };
}

export async function GET() {
  try {
    const res = await fetch(COINGECKO_URL, {
      // Pin to the same TTL as the route's revalidate so Next's data cache
      // refreshes in step with the response cache.
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { rate: FALLBACK_RATE, source: "fallback", reason: `coingecko ${res.status}` },
        { headers: { "Cache-Control": "public, s-maxage=60" } },
      );
    }
    const data = (await res.json()) as CoingeckoResponse;
    const live = data?.stellar?.php;
    if (typeof live !== "number" || !Number.isFinite(live) || live <= 0) {
      return NextResponse.json(
        { rate: FALLBACK_RATE, source: "fallback", reason: "no-rate" },
        { headers: { "Cache-Control": "public, s-maxage=60" } },
      );
    }
    return NextResponse.json(
      { rate: live, source: "coingecko", fetchedAt: Date.now() },
      // Browser caches for 5 min on top of the edge cache. Belt and suspenders.
      { headers: { "Cache-Control": "public, s-maxage=600, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        rate: FALLBACK_RATE,
        source: "fallback",
        reason: e instanceof Error ? e.message : "fetch-error",
      },
      { headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  }
}
