import { NextRequest, NextResponse } from "next/server";

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
 */
export const runtime = "nodejs";

const CHANNELS_ENDPOINT = "https://channels.openzeppelin.com/testnet";

export async function POST(req: NextRequest) {
  const apiKey = process.env.CHANNELS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CHANNELS_API_KEY missing on server" },
      { status: 500 },
    );
  }

  const body = await req.text();

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
