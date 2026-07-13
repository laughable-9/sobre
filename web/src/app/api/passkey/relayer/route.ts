import { NextRequest, NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { enforceDailyLimit } from "@/lib/rateLimit";

/**
 * Server-side proxy from passkey-kit's `PasskeyServer` (which wraps the
 * `@openzeppelin/relayer-plugin-channels` ChannelsClient) to the OpenZeppelin
 * Channels relayer service.
 *
 * The browser-side ChannelsClient POSTs JSON-RPC-like payloads (shape:
 * `{ params: { xdr } }`) to whatever `baseUrl` is configured. We point it
 * at this same-origin route so the real `CHANNELS_API_KEY` stays on the
 * server side. We then forward verbatim to the upstream Channels endpoint
 * with the key attached.
 *
 * Runtime: nodejs (not edge). The proxy is body-passthrough so it doesn't
 * pull in anything heavy, but explicit is safer.
 *
 * Auth: requireWallet() gates every call so anonymous traffic can't burn
 * the CHANNELS_API_KEY quota or submit arbitrary tx envelopes through
 * our relayer credit. Only signed-in members with a registered smart
 * wallet can drive this proxy.
 */
export const runtime = "nodejs";

const CHANNELS_ENDPOINT = "https://channels.openzeppelin.com/testnet";
/** Hard body-size ceiling. A signed Soroban tx envelope is ~2 KB; padding
 *  128 KB leaves headroom without letting an attacker push megabytes
 *  through our upstream fetch. */
const MAX_BODY_BYTES = 128 * 1024;

export async function POST(req: NextRequest) {
  const ctx = await requireWallet();
  if (ctx instanceof NextResponse) return ctx;

  const apiKey = process.env.CHANNELS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CHANNELS_API_KEY missing on server" },
      { status: 500 },
    );
  }

  const rate = await enforceDailyLimit({
    endpoint: "passkey_relayer",
    walletId: ctx.memberId,
    familyWalletId: null,
    callerEmail: ctx.email,
    perUser: 200,
    perFamily: 500,
  });
  if (rate) return rate;

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Body too large. Max ${MAX_BODY_BYTES} bytes.` },
      { status: 413 },
    );
  }

  const upstream = await fetch(CHANNELS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  const responseBody = await upstream.text();

  if (!upstream.ok) {
    console.error(
      "[relayer] Channels rejected",
      upstream.status,
      responseBody,
    );
  }

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
