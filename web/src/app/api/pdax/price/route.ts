/**
 * GET /api/pdax/price
 *
 * Returns the indicative PHP-per-token rate from PDAX's `/v1/trade/price`
 * (the v1 GET indicative endpoint — no firm quote, no idempotency tx). The
 * value is what the modal + dashboard display alongside on-chain balances.
 *
 * Caches in module memory for 30s so a busy dashboard doesn't hammer PDAX
 * once per render. PDAX UAT rates are mock-priced and slow-moving anyway.
 *
 * Auth: requires a signed-in Supabase session so this isn't publicly
 * scrapeable (rates aren't secret but the auth is consistent with the
 * other PDAX debug routes).
 */

import { NextResponse } from "next/server";

import { PAYMENT_TOKEN, PHP_PER_TOKEN_FALLBACK } from "@/lib/config";
import { pdaxEnv } from "@/lib/env";
import { pdaxFetch, PdaxError } from "@/lib/pdax/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PdaxPriceResponse {
  data: {
    base_currency: string;
    quote_currency: string;
    side: "buy" | "sell";
    base_quantity: string | number;
    price: number;
    total_amount: number;
  };
  status: string;
}

const CACHE_TTL_MS = 30_000;
let cached: { token: string; price: number; fetchedAtMs: number } | null = null;

export async function GET() {
  const sb = await createSupabaseServerClient();
  const { data: session } = await sb.auth.getSession();
  if (!session.session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = PAYMENT_TOKEN;

  if (pdaxEnv().mock) {
    return NextResponse.json({
      currency: token,
      price: PHP_PER_TOKEN_FALLBACK[token],
      cached: false,
      mock: true,
      fetched_at: new Date().toISOString(),
    });
  }

  const now = Date.now();
  if (cached && cached.token === token && now - cached.fetchedAtMs < CACHE_TTL_MS) {
    return NextResponse.json({
      currency: token,
      price: cached.price,
      cached: true,
      fetched_at: new Date(cached.fetchedAtMs).toISOString(),
    });
  }

  try {
    const resp = await pdaxFetch<PdaxPriceResponse>(
      "/pdax-institution/v1/trade/price",
      {
        query: {
          side: "buy",
          quote_currency: token,
          base_currency: "PHP",
          base_quantity: "100",
        },
      },
    );
    const price = Number(resp.data.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`PDAX returned non-positive price: ${resp.data.price}`);
    }
    cached = { token, price, fetchedAtMs: now };
    return NextResponse.json({
      currency: token,
      price,
      cached: false,
      fetched_at: new Date(now).toISOString(),
    });
  } catch (e) {
    // PDAX is occasionally flaky on UAT — fall back to the hardcoded
    // value rather than blowing up the dashboard. Surface the failure
    // detail so the modal can hint at staleness if needed.
    const fallback = PHP_PER_TOKEN_FALLBACK[token];
    const message = e instanceof PdaxError
      ? `PDAX ${e.status}: ${typeof e.body === "object" && e.body !== null && "message" in e.body
          ? (e.body as { message: string }).message
          : "unknown"}`
      : e instanceof Error
        ? e.message
        : String(e);
    return NextResponse.json(
      {
        currency: token,
        price: fallback,
        cached: false,
        fallback: true,
        fetched_at: new Date(now).toISOString(),
        error: message,
      },
      { status: 200 },
    );
  }
}
