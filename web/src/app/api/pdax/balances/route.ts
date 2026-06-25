/**
 * GET /api/pdax/balances
 *
 * Debug. Returns Sobre's institution balances at PDAX. Useful to confirm
 * credentials + the token rotation are working before anyone tries an
 * actual deposit. Requires a signed-in Supabase session so this isn't
 * publicly readable.
 */

import { NextResponse } from "next/server";

import { pdaxEnv } from "@/lib/env";
import { pdaxFetch, PdaxError } from "@/lib/pdax/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PdaxBalanceRow {
  currency: string;
  available: string;
  hold: string;
  total: string;
  asset_type: "CRYPTO" | "FIAT";
}

export async function GET() {
  const sb = await createSupabaseServerClient();
  const { data: session } = await sb.auth.getSession();
  if (!session.session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pdaxEnv().mock) {
    return NextResponse.json({
      mock: true,
      balances: [
        { currency: "PHP", available: "0", hold: "0", total: "0", asset_type: "FIAT" },
        { currency: "USDCXLM", available: "0", hold: "0", total: "0", asset_type: "CRYPTO" },
      ],
    });
  }

  try {
    const resp = await pdaxFetch<{ data: PdaxBalanceRow[]; status: string }>(
      "/pdax-institution/v1/balances",
    );
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
