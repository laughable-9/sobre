/**
 * Server-side rate proxy. Fetches XLM/PHP from CoinGecko once per ISR window
 * and serves the cached result to every browser client, so CoinGecko sees one
 * origin (this server) instead of N user-agents and we stay under their free
 * tier rate limit at any user count.
 */

import { NextResponse } from "next/server";

import { PHP_PER_XLM as FALLBACK_RATE } from "@/lib/config";

export const runtime = "edge";
// 10-minute server cache. Vercel serves the same response to every client
// hitting the route within this window from the edge.
export const revalidate = 600;

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=php";

const FRESH_HEADERS = {
  // Edge caches the response for 10 min; browsers cache for 5 min on top.
  "Cache-Control": "public, s-maxage=600, max-age=300",
};
const FALLBACK_HEADERS = {
  // Shorter window on fallbacks so CoinGecko gets retried sooner.
  "Cache-Control": "public, s-maxage=60",
};

function fallback() {
  return NextResponse.json({ rate: FALLBACK_RATE }, { headers: FALLBACK_HEADERS });
}

interface CoingeckoResponse {
  stellar?: { php?: number };
}

export async function GET() {
  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) return fallback();
    const data = (await res.json()) as CoingeckoResponse;
    const live = data?.stellar?.php;
    if (typeof live !== "number" || !Number.isFinite(live) || live <= 0) {
      return fallback();
    }
    return NextResponse.json({ rate: live }, { headers: FRESH_HEADERS });
  } catch {
    return fallback();
  }
}
