/**
 * GET /api/pdax/balances
 *
 * Debug. Returns Sobre's institution balances at PDAX. Useful to confirm
 * credentials + the token rotation are working before anyone tries an
 * actual deposit. Requires a signed-in wallet.
 *
 * Cached for 30 s in-process so repeated dashboard checks don't hammer
 * PDAX's balances endpoint.
 */

import { NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { pdaxEnv } from "@/lib/env";
import { pdaxFetch, PdaxError } from "@/lib/pdax/client";
import { enforceDailyLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface PdaxBalanceRow {
  currency: string;
  available: string;
  hold: string;
  total: string;
  asset_type: "CRYPTO" | "FIAT";
}

interface CacheEntry {
  at: number;
  balances: PdaxBalanceRow[];
}
const CACHE_MS = 30 * 1000;
let cache: CacheEntry | null = null;

export async function GET() {
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;

  const rate = await enforceDailyLimit({
    endpoint: "pdax_balances",
    walletId: ctx.memberId,
    familyWalletId: null,
    callerEmail: ctx.email,
    perUser: 30,
    perFamily: 60,
  });
  if (rate) return rate;

  if (pdaxEnv().mock) {
    return NextResponse.json({
      mock: true,
      balances: [
        { currency: "PHP", available: "0", hold: "0", total: "0", asset_type: "FIAT" },
        { currency: "USDCXLM", available: "0", hold: "0", total: "0", asset_type: "CRYPTO" },
      ],
    });
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json({ balances: cache.balances, cached: true });
  }

  try {
    const resp = await pdaxFetch<{ data: PdaxBalanceRow[]; status: string }>(
      "/pdax-institution/v1/balances",
    );
    cache = { at: now, balances: resp.data };
    return NextResponse.json({ balances: resp.data });
  } catch (e) {
    if (e instanceof PdaxError) {
      return NextResponse.json(
        { error: "PDAX rejected", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
