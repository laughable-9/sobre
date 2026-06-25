/**
 * Force a fresh PDAX login + return the access_token expiry. Useful for
 * dev — hit this to confirm credentials are valid before wiring the rest
 * of the flow. Production code never calls this directly; `pdaxFetch()`
 * handles auth transparently.
 */

import { NextResponse } from "next/server";

import { pdaxEnv } from "@/lib/env";
import { pdaxFetch, resetPdaxTokens, PdaxError } from "@/lib/pdax/client";

export const runtime = "nodejs";

export async function POST() {
  const env = pdaxEnv();
  if (env.mock) {
    return NextResponse.json({ ok: true, mock: true });
  }
  resetPdaxTokens();
  try {
    const balances = await pdaxFetch<{ data: unknown; status: string }>(
      "/pdax-institution/v1/balances",
    );
    return NextResponse.json({ ok: true, balances });
  } catch (e) {
    if (e instanceof PdaxError) {
      return NextResponse.json(
        { ok: false, status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
