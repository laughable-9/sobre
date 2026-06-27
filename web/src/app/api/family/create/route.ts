/**
 * POST /api/family/create
 *
 * Server-side mirror of a freshly-deployed family Sobre into Supabase.
 * Replaces the client-side `family_wallets` INSERT that used to live in
 * `useCreateSobre` + `createFamilyWallet`.
 *
 * The previous client-side path let any authenticated user pre-insert a
 * row with `(contract_id, created_by=self)` to squat on a not-yet-deployed
 * Sobre. Factory salts are monotonic, so the next address is predictable;
 * an attacker who pre-inserted would have the `bootstrap_family_admin`
 * trigger promote them, and the victim's later mirror would fail the
 * `UNIQUE(contract_id)` constraint. This route closes the gap by verifying
 * the contract's on-chain admin matches the caller before inserting.
 */

import { Address } from "@stellar/stellar-sdk";
import { NextResponse } from "next/server";

import { requireWallet } from "@/lib/auth/familyMember";
import { simulateReadServer } from "@/lib/contractServer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface PostBody {
  contract_id: string;
  display_name: string;
  percents: [number, number, number];
  admin_name: string;
  admin_emoji: string;
  envelope_names: [string, string, string];
}

function isValidBody(b: unknown): b is PostBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  if (typeof o.contract_id !== "string" || !o.contract_id.startsWith("C")) {
    return false;
  }
  if (typeof o.display_name !== "string") return false;
  if (typeof o.admin_name !== "string" || typeof o.admin_emoji !== "string") {
    return false;
  }
  if (
    !Array.isArray(o.percents) ||
    o.percents.length !== 3 ||
    o.percents.some((p) => typeof p !== "number") ||
    o.percents.reduce((a: number, b: unknown) => a + (b as number), 0) !== 100
  ) {
    return false;
  }
  if (
    !Array.isArray(o.envelope_names) ||
    o.envelope_names.length !== 3 ||
    o.envelope_names.some((n) => typeof n !== "string")
  ) {
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!isValidBody(body)) {
    return NextResponse.json(
      {
        error:
          "Invalid body. Expect { contract_id, display_name, percents:[3], admin_name, admin_emoji, envelope_names:[3] } with percents summing to 100.",
      },
      { status: 400 },
    );
  }

  // Auth and the on-chain admin lookup are independent — race them to cut
  // ~one round-trip off the critical path. The simulate is the dominant
  // cost (~100-300ms) so it overlaps with auth's ~30-100ms.
  const [ctxOrRes, onChainState] = await Promise.all([
    requireWallet(),
    simulateReadServer<{ admin?: string }>(body.contract_id, "get_state"),
  ]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const ctx = ctxOrRes;

  if (!onChainState?.admin) {
    return NextResponse.json(
      {
        error:
          "Couldn't read the new wallet from the network. Wait a few seconds and try again.",
      },
      { status: 404 },
    );
  }
  try {
    if (
      Address.fromString(onChainState.admin).toString() !==
      Address.fromString(ctx.contractId).toString()
    ) {
      return NextResponse.json(
        { error: "You aren't the admin of that wallet on chain." },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Couldn't parse admin address." },
      { status: 500 },
    );
  }

  const admin = getSupabaseAdmin();

  // Insert family_wallets first — the bootstrap_family_admin trigger
  // creates the admin's family_members row with role='admin'. Then seed
  // display data in parallel.
  const { data: family, error: insertErr } = await admin
    .from("family_wallets")
    .insert({
      contract_id: body.contract_id,
      display_name: body.display_name,
      created_by: ctx.memberId,
      percents: body.percents,
    })
    .select("id")
    .single();
  if (insertErr) {
    return NextResponse.json(
      { error: `family_wallets insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }
  const familyWalletId = (family as { id: string }).id;

  const [g, t, s] = body.envelope_names;
  const [memberRes, namesRes] = await Promise.all([
    admin
      .from("family_members")
      .update({ name: body.admin_name, emoji: body.admin_emoji })
      .eq("family_wallet_id", familyWalletId)
      .eq("wallet_id", ctx.memberId),
    admin.from("family_envelope_names").insert([
      { family_wallet_id: familyWalletId, envelope_key: "Groceries", display_name: g },
      { family_wallet_id: familyWalletId, envelope_key: "Tuition", display_name: t },
      { family_wallet_id: familyWalletId, envelope_key: "Savings", display_name: s },
    ]),
  ]);
  if (memberRes.error) {
    return NextResponse.json(
      { error: `admin family_members update failed: ${memberRes.error.message}` },
      { status: 500 },
    );
  }
  if (namesRes.error) {
    return NextResponse.json(
      { error: `envelope names insert failed: ${namesRes.error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ family_wallet_id: familyWalletId });
}
