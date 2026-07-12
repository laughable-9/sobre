/**
 * Browser-side codec + URL helpers shared by the invite-link flow
 * (producer in `useCreateInvite`, consumer in `/invite/[token]`). Lives in
 * `lib/` rather than next to either consumer so URL-shape or codec changes
 * touch one file.
 */

import { APP_ORIGIN } from "@/lib/config";

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice(0, (4 - (input.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // Cast: lib.dom's BufferSource excludes Uint8Array<ArrayBufferLike> under
  // strict TS — runtime is fine since `new Uint8Array(n).buffer` is always
  // ArrayBuffer here (no SharedArrayBuffer construction path).
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

/** Build the invite URL the admin shares. Hardcoded to `APP_ORIGIN` so a
 *  link minted from `localhost:3000` during local dev still resolves to the
 *  deployed app when the recipient opens it. `variant` maps to the `?as=`
 *  query the landing page reads to pick the join flow. Owns the URL shape
 *  for every invite type — do not decorate `?as=` at the call site. */
export function buildInviteUrl(
  contractId: string,
  tokenBase64Url: string,
  variant: "member" | "admin" | "subaccount" = "member",
): string {
  const base = `${APP_ORIGIN}/invite/${tokenBase64Url}?wallet=${contractId}`;
  return variant === "member" ? base : `${base}&as=${variant}`;
}

/** Lowercase hex string of an arbitrary byte array. Shared by the on-chain
 *  invite mint (hex on family_subaccounts.invite_token_hash) and any
 *  caller that needs to derive a stable id from a hash digest. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Inverse of `bytesToHex`. Throws on odd length or non-hex chars so a
 *  Supabase-supplied invite_token_hash that got mangled somewhere in
 *  transit fails loud instead of quietly zeroing out. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length input (${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: non-hex byte at offset ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

/** Postgres bytea literal string — `\x` prefix followed by lowercase hex.
 *  PostgREST accepts this shape for bytea column inserts and RPC bytea
 *  arguments; use it wherever a Uint8Array (typically a sha256 digest)
 *  needs to cross the Supabase boundary. */
export function byteaLiteral(bytes: Uint8Array): string {
  return `\\x${bytesToHex(bytes)}`;
}

/** base64url → 32-byte plaintext invite token, or null on malformed input.
 *  The contract's `join_wallet` rejects with `InviteNotFound` if the wrong
 *  length lands on chain, but failing client-side first surfaces a clear
 *  "this link is broken" UX without burning a tx. */
export function decodeInviteToken(tokenBase64Url: string): Uint8Array | null {
  try {
    const bytes = base64UrlDecode(tokenBase64Url);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}
