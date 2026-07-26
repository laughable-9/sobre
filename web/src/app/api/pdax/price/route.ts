/**
 * GET /api/pdax/price
 *
 * Returns the PHP-per-token rate the modal + dashboard display alongside
 * on-chain balances. For XLM this is PDAX's indicative `/v1/trade/price`.
 * For USDC it is the EFFECTIVE rate through our actual rails (PDAX PHP/XLM
 * price x Soroswap pool XLM-per-USDC) — see effectivePhpPerUsdc below for
 * the full rationale.
 *
 * Caches in module memory for 30s so a busy dashboard doesn't hammer PDAX
 * or the Soroban RPC once per render; failures negative-cache for 10s so
 * an upstream outage doesn't multiply per client poll.
 *
 * Auth: requires a signed-in Supabase session so this isn't publicly
 * scrapeable (rates aren't secret but the auth is consistent with the
 * other PDAX debug routes).
 */

import { NextResponse } from "next/server";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

import {
  PAYMENT_TOKEN,
  PAYMENT_TOKEN_SAC_ID,
  PHP_PER_TOKEN_FALLBACK,
  SOROSWAP_ROUTER_ID,
  STROOPS_PER_TOKEN,
  XLM_SAC_ID,
} from "@/lib/config";
import { simulateReadServer } from "@/lib/contractServer";
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
/** Negative-cache window after an upstream failure. Short enough to
 *  recover fast, long enough that a PDAX/RPC outage doesn't cost up to
 *  three upstream calls per client poll. */
const FAILURE_TTL_MS = 10_000;
let cached: { token: string; price: number; fetchedAtMs: number } | null = null;
let failedUntilMs = 0;

/** Extra detail carried alongside the composed USDC rate so the response
 *  is verifiable (and degradation visible) from the JSON alone. */
interface RateLegs {
  php_per_xlm?: number;
  xlm_per_usdc?: number;
  /** False when the pool quote failed and the rate fell back to PDAX's
   *  USDC ticker instead of the effective rails rate. */
  effective?: boolean;
}

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

  if (now < failedUntilMs) {
    return NextResponse.json({
      currency: token,
      price: cached?.token === token ? cached.price : PHP_PER_TOKEN_FALLBACK[token],
      cached: true,
      fallback: true,
      fetched_at: new Date(now).toISOString(),
      error: "upstream failed recently; negative-cached",
    });
  }

  try {
    const legs: RateLegs = {};
    const price = token === "USDC"
      ? await effectivePhpPerUsdc(legs)
      : await pdaxPhpPerToken(token);
    cached = { token, price, fetchedAtMs: now };
    return NextResponse.json({
      currency: token,
      price,
      cached: false,
      fetched_at: new Date(now).toISOString(),
      ...legs,
    });
  } catch (e) {
    // PDAX is occasionally flaky on UAT — fall back to the hardcoded
    // value rather than blowing up the dashboard. Surface the failure
    // detail so the modal can hint at staleness if needed.
    failedUntilMs = Date.now() + FAILURE_TTL_MS;
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

/** PDAX's indicative PHP-per-token price (v1 GET, no firm quote). */
async function pdaxPhpPerToken(quoteCurrency: string): Promise<number> {
  const resp = await pdaxFetch<PdaxPriceResponse>(
    "/pdax-institution/v1/trade/price",
    {
      query: {
        side: "buy",
        quote_currency: quoteCurrency,
        base_currency: "PHP",
        base_quantity: "100",
      },
    },
  );
  const price = Number(resp.data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`PDAX returned non-positive price: ${resp.data.price}`);
  }
  return price;
}

/**
 * Effective PHP-per-USDC through the rails money actually moves on. PDAX
 * only trades PHP<->XLM in UAT (its USDCXLM market returns "Asset
 * unavailable", probed 2026-07-26), so every deposit buys XLM at PDAX's
 * market price and swaps XLM->USDC on the testnet Soroswap pool; cashouts
 * run the same two legs in reverse. Valuing USDC at PDAX's unrelated USDC
 * ticker made deposits look lossy whenever the pool drifted off market
 * (no arbitrageurs on testnet): a P500 deposit displayed as P411 even
 * though cashing it out would return ~P500. The redemption value of 1
 * USDC on our rails is php_per_xlm * xlm_per_usdc(pool), so that is what
 * we display. Quoted in the pool's sell direction (USDC -> XLM), which
 * bakes in the LP fee a real cashout pays.
 *
 * Falls back to PDAX's USDC ticker if the pool quote fails, so a Soroswap
 * outage degrades to the old behavior instead of a dead dashboard — the
 * degradation is tagged `effective: false` in the response.
 */
async function effectivePhpPerUsdc(legs: RateLegs): Promise<number> {
  // Independent upstreams — quote them concurrently. A pool-leg failure
  // resolves to null (simulateReadServer swallows) rather than rejecting,
  // so Promise.all cannot mask the PDAX error path.
  const [phpPerXlm, amounts] = await Promise.all([
    pdaxPhpPerToken("XLM"),
    simulateReadServer<bigint[]>(
      SOROSWAP_ROUTER_ID,
      "router_get_amounts_out",
      [
        nativeToScVal(STROOPS_PER_TOKEN, { type: "i128" }),
        xdr.ScVal.scvVec([
          Address.fromString(PAYMENT_TOKEN_SAC_ID).toScVal(),
          Address.fromString(XLM_SAC_ID).toScVal(),
        ]),
      ],
    ),
  ]);
  const xlmOut = amounts?.[amounts.length - 1];
  if (typeof xlmOut !== "bigint" || xlmOut <= 0n) {
    legs.effective = false;
    return pdaxPhpPerToken("USDC");
  }
  const xlmPerUsdc = Number(xlmOut) / STROOPS_PER_TOKEN;
  legs.effective = true;
  legs.php_per_xlm = phpPerXlm;
  legs.xlm_per_usdc = xlmPerUsdc;
  return phpPerXlm * xlmPerUsdc;
}
