/**
 * POST /api/subaccount/join
 *
 * Server-side claim step of the sub-account invite flow. The joiner has
 * already redeemed the invite on-chain via `join_as_subaccount`; this route
 * mirrors that into Supabase by setting `family_subaccounts.wallet_id` on
 * the pending row.
 *
 * Why a route instead of a client-side RLS UPDATE: the only client-safe
 * gate was `USING (wallet_id IS NULL)`, which lets an unscoped UPDATE
 * sweep every pending row across the app. Verifying on-chain that the
 * caller is actually in `get_state().subaccounts` is the safe check, and
 * that requires an RPC simulate — server-side.
 */

import { createHash } from "node:crypto";
import { Address } from "@stellar/stellar-sdk";
import { NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { simulateReadServer } from "@/lib/contractServer";
import { base64UrlDecode } from "@/lib/encoding";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface PostBody {
  contract_id: string;
  /** base64url-encoded 32-byte plaintext invite token (the URL fragment). */
  invite_token: string;
}

interface OnChainStateShape {
  subaccounts?: { address?: string }[];
}

function isValidBody(b: unknown): b is PostBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.contract_id === "string" &&
    o.contract_id.startsWith("C") &&
    typeof o.invite_token === "string" &&
    o.invite_token.length > 0
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Invalid body. Expect { contract_id, invite_token }." },
      { status: 400 },
    );
  }

  let tokenBytes: Uint8Array;
  try {
    tokenBytes = base64UrlDecode(body.invite_token);
  } catch {
    return NextResponse.json(
      { error: "Malformed invite token." },
      { status: 400 },
    );
  }
  if (tokenBytes.length !== 32) {
    return NextResponse.json(
      { error: "Invite token must be 32 bytes." },
      { status: 400 },
    );
  }

  const tokenHashHex = createHash("sha256").update(tokenBytes).digest("hex");

  const ctxOrRes = await requireWallet();
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const ctx = ctxOrRes;

  // Per-wallet cap. Loops 5 Soroban simulates per call with 800ms sleeps
  // between; without this a bad actor could hammer our RPC quota.
  const rate = await enforceDailyLimit({
    endpoint: "subaccount_join",
    walletId: ctx.memberId,
    familyWalletId: null,
    callerEmail: ctx.email,
    perUser: 20,
    perFamily: 20,
  });
  if (rate) return rate;

  // Soroban RPC replicas index ledger writes asynchronously — the joiner's
  // join_as_subaccount tx may have landed seconds ago but the replica
  // serving our simulate hasn't picked it up yet. Without this retry the
  // race surfaces as a one-shot 403, which the joiner's form swallows
  // (auto-bounce on alreadySubaccount still fires from the dashboard's
  // own polled state) — leaving the family_subaccounts row pending
  // forever. Total budget ~4s; in practice the second or third attempt
  // hits an indexed replica.
  const callerStrkey = Address.fromString(ctx.contractId).toString();
  const ATTEMPTS = 5;
  let lastError: "no_state" | "no_hit" | null = "no_state";
  for (let i = 0; i < ATTEMPTS; i++) {
    const onChainState = await simulateReadServer<OnChainStateShape>(
      body.contract_id,
      "get_state",
    );
    if (!onChainState?.subaccounts) {
      lastError = "no_state";
    } else {
      const hit = onChainState.subaccounts.some((s) => {
        if (!s?.address) return false;
        try {
          return Address.fromString(s.address).toString() === callerStrkey;
        } catch {
          return false;
        }
      });
      if (hit) {
        lastError = null;
        break;
      }
      lastError = "no_hit";
    }
    if (i < ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (lastError === "no_state") {
    return NextResponse.json(
      {
        error:
          "Couldn't read the wallet from the network. Wait a few seconds and try again.",
      },
      { status: 404 },
    );
  }
  if (lastError === "no_hit") {
    return NextResponse.json(
      {
        error:
          "We don't see you as a sub-account on the wallet yet. Try again in a moment.",
      },
      { status: 403 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: row, error: lookupErr } = await admin
    .from("family_subaccounts")
    .select("id, family_wallet_id, wallet_id")
    .eq("invite_token_hash", tokenHashHex)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { error: `Lookup failed: ${lookupErr.message}` },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json(
      { error: "Invite not found." },
      { status: 404 },
    );
  }
  const r = row as {
    id: string;
    family_wallet_id: string;
    wallet_id: string | null;
  };
  if (r.wallet_id) {
    // Already claimed — idempotent return for the legitimate joiner so a
    // double-tap doesn't surface as an error toast.
    if (r.wallet_id === ctx.memberId) {
      return NextResponse.json({
        family_subaccount_id: r.id,
        family_wallet_id: r.family_wallet_id,
      });
    }
    return NextResponse.json(
      { error: "This invite has already been claimed by another wallet." },
      { status: 409 },
    );
  }

  const { data: claimed, error: updateErr } = await admin
    .from("family_subaccounts")
    .update({
      wallet_id: ctx.memberId,
      // Denormalise the joiner's smart-wallet C-address so the admin
      // panel can match against on-chain get_state.subaccounts without
      // needing wallets.contract_id via a join (wallets RLS is own-row
      // only and can't be widened — see the wallets_read_family_peers
      // backout migration).
      wallet_address: ctx.contractId,
      // Overwrite the "Awaiting sign-in" placeholder set at invite time
      // with the joiner's Google display name.
      display_name: ctx.fullName,
    })
    .eq("id", r.id)
    .is("wallet_id", null)
    .select("id");
  if (updateErr) {
    return NextResponse.json(
      { error: `Claim failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  // Concurrency guard: two parallel POSTs both pass the wallet_id-null
  // check at lookup time, only one wins the atomic UPDATE. Without a
  // 0-row signal the loser returns 200 with the WINNER's row id —
  // legitimate-looking success that left wallet_id linked to the
  // wrong wallet. Re-read to see who actually owns the row now.
  if (!claimed?.length) {
    const { data: now } = await admin
      .from("family_subaccounts")
      .select("wallet_id")
      .eq("id", r.id)
      .single();
    const owner = (now as { wallet_id: string | null } | null)?.wallet_id;
    if (owner === ctx.memberId) {
      // We won an earlier race; idempotent success.
      return NextResponse.json({
        family_subaccount_id: r.id,
        family_wallet_id: r.family_wallet_id,
      });
    }
    return NextResponse.json(
      { error: "This invite has already been claimed by another wallet." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    family_subaccount_id: r.id,
    family_wallet_id: r.family_wallet_id,
  });
}
