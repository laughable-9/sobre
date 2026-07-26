"use client";

import { Address, xdr } from "@stellar/stellar-sdk";

import {
  BLEND_POOL_ID,
  EARN_AVAILABLE,
  FACTORY_CONTRACT_ID,
  LAUNCHER_CONTRACT_ID,
  MOCK_USDY_ID,
  PAYMENT_TOKEN_SAC_ID,
  SOROSWAP_ROUTER_ID,
  XLM_SAC_ID,
} from "@/lib/config";
import { invokeWrite } from "@/lib/contract";
import { makePendingSlot } from "@/lib/pendingMutation";

/** Family-wallet creation: one launcher transaction on chain, then the
 *  Supabase mirror. See createSobreOnChain / createFamilyWallet below. */

export interface CreateFamilyArgs {
  /** Smart wallet C-address that will sign + become admin on chain. */
  myWalletContractId: string;
  envelopeNames: readonly [string, string, string];
  /** Per-envelope icon key; null slots take the built-in default. */
  envelopeIcons?: readonly [string | null, string | null, string | null];
  percents: readonly [number, number, number];
  /** Display name written to family_wallets.display_name. */
  walletName: string;
  adminName: string;
  /** Onboarding metadata — off-chain, optional. Omitted by the dashboard
   *  create path; supplied by the creator onboarding flow. */
  householdType?: "family-at-home" | "both-abroad" | "scratch" | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
}

export interface CreateFamilyResult {
  familyContractId: string;
  familyWalletId: string;
}

/** Resume checkpoint for the chain half of a create. If the launcher tx
 *  lands but the Supabase mirror trips (RPC lag, tab reload), the retry
 *  reuses the deployed contract instead of deploying a second one and
 *  re-prompting Face ID. Lives here so BOTH create paths (dashboard hook
 *  and onboarding) inherit it. Keyed `.v2`: the pre-launcher slot stored
 *  per-step grow/earn flags, and resuming one of those partial records
 *  would skip the enables. Old records just expire via the slot TTL. */
const createSlot = makePendingSlot<string>(
  "sobre.pendingCreate.v2",
  (v): v is string => typeof v === "string" && v.startsWith("C"),
);

/** Call after the Supabase mirror succeeds so the next create starts
 *  fresh instead of resuming a completed one. */
export function clearCreateCheckpoint(adminWalletAddress: string): void {
  createSlot.clear(adminWalletAddress);
}

/**
 * One-transaction Sobre creation via the SobreLauncher: factory deploy +
 * grow_enable + (when EARN_AVAILABLE) earn_enable, chained behind a single
 * admin auth entry so the user's passkey prompts once. Grow must be on
 * before the first PDAX deposit — `deposit_from_xlm` reads Blend +
 * Soroswap addresses out of Grow storage — and Earn puts the Savings
 * yield on from day one. Returns the new Sobre's contract address.
 *
 * Shared by `useCreateSobre` (dashboard create) and `createFamilyWallet`
 * (onboarding) so the two paths can't drift. Resumes from the checkpoint
 * above; callers clear it via clearCreateCheckpoint after their mirror.
 */
export async function createSobreOnChain(
  adminWalletAddress: string,
): Promise<string> {
  const resumed = createSlot.read(adminWalletAddress);
  if (resumed) return resumed;

  const { returnValue } = await invokeWrite(
    LAUNCHER_CONTRACT_ID,
    "create_sobre_full",
    [
      Address.fromString(adminWalletAddress).toScVal(),
      Address.fromString(FACTORY_CONTRACT_ID).toScVal(),
      Address.fromString(PAYMENT_TOKEN_SAC_ID).toScVal(),
      Address.fromString(BLEND_POOL_ID).toScVal(),
      Address.fromString(XLM_SAC_ID).toScVal(),
      Address.fromString(SOROSWAP_ROUTER_ID).toScVal(),
      // Option<Address>: scvVoid encodes None. Earn is skipped when the
      // payment token can't back MockUSDY — earn_enable would trap and
      // take the whole create down with it.
      EARN_AVAILABLE
        ? Address.fromString(MOCK_USDY_ID).toScVal()
        : xdr.ScVal.scvVoid(),
    ],
  );
  if (typeof returnValue !== "string" || !returnValue.startsWith("C")) {
    throw new Error(
      `create_sobre_full returned no contract address (got: ${String(returnValue)})`,
    );
  }
  createSlot.write(adminWalletAddress, returnValue);
  return returnValue;
}

export async function createFamilyWallet(
  args: CreateFamilyArgs,
): Promise<CreateFamilyResult> {
  const familyContractId = await createSobreOnChain(args.myWalletContractId);

  // Mirror via the server-side route that verifies caller is the on-chain
  // admin of the new contract (closes the "predict next salt + pre-insert"
  // squat). Client-side INSERT on family_wallets is RLS-revoked.
  const { familyWalletId } = await mirrorFamilyCreate({
    contractId: familyContractId,
    displayName: args.walletName,
    percents: args.percents,
    adminName: args.adminName,
    envelopeNames: args.envelopeNames,
    envelopeIcons: args.envelopeIcons,
    householdType: args.householdType ?? null,
    budgetMin: args.budgetMin ?? null,
    budgetMax: args.budgetMax ?? null,
  });
  clearCreateCheckpoint(args.myWalletContractId);

  return { familyContractId, familyWalletId };
}

/**
 * POST a new family to /api/family/create. Shared by `useCreateSobre` and
 * the cold-start `createFamilyWallet` flow so the request shape lives in
 * one place (server-side validation in
 * `web/src/app/api/family/create/route.ts` must agree with this body).
 */
export async function mirrorFamilyCreate(args: {
  contractId: string;
  displayName: string;
  percents: readonly [number, number, number];
  adminName: string;
  envelopeNames: readonly [string, string, string];
  envelopeIcons?: readonly [string | null, string | null, string | null];
  /** Onboarding metadata — off-chain, all optional. Validated + stored by the
   *  route; omit for the non-onboarding (dashboard) create path. */
  householdType?: "family-at-home" | "both-abroad" | "scratch" | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
}): Promise<{ familyWalletId: string }> {
  const res = await fetch("/api/family/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contract_id: args.contractId,
      display_name: args.displayName,
      percents: [...args.percents],
      admin_name: args.adminName,
      envelope_names: [...args.envelopeNames],
      ...(args.envelopeIcons
        ? { envelope_icons: [...args.envelopeIcons] }
        : {}),
      // Only include when provided so the route sees `undefined` (→ NULL) not
      // a spurious value on the dashboard create path.
      ...(args.householdType != null
        ? { household_type: args.householdType }
        : {}),
      ...(args.budgetMin != null ? { budget_min: args.budgetMin } : {}),
      ...(args.budgetMax != null ? { budget_max: args.budgetMax } : {}),
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `Wallet deployed on chain but Supabase mirror failed: ${j.error ?? `${res.status}`}`,
    );
  }
  const { family_wallet_id } = (await res.json()) as {
    family_wallet_id: string;
  };
  return { familyWalletId: family_wallet_id };
}

/** "Kyle Pagunsan" → "The Pagunsan Family". Falls back to "Sobre Family"
 *  when the name doesn't split into recognisable parts. */
export function deriveFamilyName(fullName: string | null | undefined): string {
  if (!fullName) return "Sobre Family";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? `The ${last} Family` : "Sobre Family";
}
