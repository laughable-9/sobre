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
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Household types offered in onboarding. Kept in sync with the DB CHECK
 *  constraint on family_wallets.household_type and the onboarding UI. */
const HOUSEHOLD_TYPES = ["family-at-home", "both-abroad", "scratch"] as const;
type HouseholdType = (typeof HOUSEHOLD_TYPES)[number];

/** Sanity ceiling for a monthly budget bound, in whole PHP. Guards against a
 *  fat-fingered / hostile value; the split preview never needs more. */
const MAX_BUDGET_PHP = 100_000_000;

interface PostBody {
  contract_id: string;
  display_name: string;
  percents: [number, number, number];
  admin_name: string;
  envelope_names: [string, string, string];
  /** Per-envelope icon key; null slots fall back to the default. Optional
   *  so older callers (that don't customise icons) still work. */
  envelope_icons?: [string | null, string | null, string | null];
  // Onboarding metadata — off-chain only, all optional (columns are nullable).
  household_type?: HouseholdType | null;
  budget_min?: number | null;
  budget_max?: number | null;
}

/** A budget bound is valid when omitted/null, or a finite non-negative number
 *  within the ceiling with at most 2 decimal places (PHP centavos). Never
 *  trust the client — mirrors the DB numeric(12,2) + CHECKs. */
function isValidBudgetBound(v: unknown): v is number | null | undefined {
  if (v === undefined || v === null) return true;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_BUDGET_PHP) {
    return false;
  }
  // At most 2 decimal places. Compare against the rounded-to-centavos value
  // (epsilon guards float representation error, e.g. 15000.1 * 100).
  const centavos = Math.round(v * 100);
  return Math.abs(v * 100 - centavos) < 1e-6;
}

function isValidBody(b: unknown): b is PostBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  if (typeof o.contract_id !== "string" || !o.contract_id.startsWith("C")) {
    return false;
  }
  if (typeof o.display_name !== "string") return false;
  if (typeof o.admin_name !== "string") return false;
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
  if (o.envelope_icons !== undefined) {
    if (
      !Array.isArray(o.envelope_icons) ||
      o.envelope_icons.length !== 3 ||
      o.envelope_icons.some((k) => k !== null && typeof k !== "string")
    ) {
      return false;
    }
  }
  // Onboarding metadata (all optional). Validate shape when present.
  if (
    o.household_type !== undefined &&
    o.household_type !== null &&
    !HOUSEHOLD_TYPES.includes(o.household_type as HouseholdType)
  ) {
    return false;
  }
  if (!isValidBudgetBound(o.budget_min) || !isValidBudgetBound(o.budget_max)) {
    return false;
  }
  if (
    typeof o.budget_min === "number" &&
    typeof o.budget_max === "number" &&
    o.budget_min > o.budget_max
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
          "Invalid body. Expect { contract_id, display_name, percents:[3], admin_name, envelope_names:[3] } with percents summing to 100.",
      },
      { status: 400 },
    );
  }

  // Auth first so we can key the rate limit on the caller. The Soroban
  // simulate below can burn RPC quota if we let unlimited junk contract_id
  // posts through; race the limit against the simulate to keep the wall
  // clock similar while still gating the RPC call on today's cap.
  const ctxOrRes = await requireWallet();
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const ctx = ctxOrRes;

  const readAdmin = () =>
    simulateReadServer<{ admin?: string }>(body.contract_id, "get_state");

  // Per-wallet cap. Real users create maybe one Sobre a lifetime, so 5/day
  // stops loop abuse without ever tripping legitimate flows. No family
  // scope yet at this point (that's what this route creates).
  const [rate, initialState] = await Promise.all([
    enforceDailyLimit({
      endpoint: "family_create",
      walletId: ctx.memberId,
      familyWalletId: null,
      callerEmail: ctx.email,
      perUser: 5,
      perFamily: 5,
    }),
    readAdmin(),
  ]);
  if (rate) return rate;

  // The client polled its own tx to SUCCESS before POSTing here, but the
  // public RPC (`soroban-testnet.stellar.org`) is load-balanced across
  // backends whose ledger tips drift by a few seconds. If we hit a lagging
  // backend, the fresh contract's `get_state` returns nothing. Backoff-retry
  // covers the drift invisibly; ~6.2s total, first retry lands ~500ms sooner
  // than a naive doubling schedule for the common short-lag case.
  let onChainState = initialState;
  if (!onChainState?.admin) {
    for (const delayMs of [300, 900, 2000, 3000]) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      onChainState = await readAdmin();
      if (onChainState?.admin) break;
    }
  }

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
      // Onboarding metadata — off-chain, nullable. `?? null` so an absent
      // field lands as SQL NULL rather than `undefined`.
      household_type: body.household_type ?? null,
      budget_min: body.budget_min ?? null,
      budget_max: body.budget_max ?? null,
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
  const icons = body.envelope_icons ?? [null, null, null];
  const [memberRes, namesRes] = await Promise.all([
    admin
      .from("family_members")
      .update({ name: body.admin_name })
      .eq("family_wallet_id", familyWalletId)
      .eq("wallet_id", ctx.memberId),
    admin.from("family_envelope_names").insert([
      { family_wallet_id: familyWalletId, envelope_key: "Groceries", display_name: g, icon: icons[0] },
      { family_wallet_id: familyWalletId, envelope_key: "Tuition", display_name: t, icon: icons[1] },
      { family_wallet_id: familyWalletId, envelope_key: "Savings", display_name: s, icon: icons[2] },
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
