"use client";

import { Address, contract } from "@stellar/stellar-sdk";

import {
  BLEND_POOL_ID,
  EARN_AVAILABLE,
  FACTORY_CONTRACT_ID,
  MOCK_USDY_ID,
  NETWORK,
  PAYMENT_TOKEN_SAC_ID,
  SOROSWAP_ROUTER_ID,
  XLM_SAC_ID,
} from "@/lib/config";
import { invokeWrite } from "@/lib/contract";
import {
  getDeployerAddress,
  signTransaction,
  submitPasskeySigned,
} from "@/lib/passkey";

/**
 * Family-wallet creation flow.
 *
 *   1. Load the factory contract's spec from chain (one network round-trip).
 *   2. Build an AssembledTransaction for `create_sobre(admin, payment_token,
 *      percents)` with the caller's smart wallet C-address as admin. Display
 *      fields (wallet name, envelope names, admin display name) are NO
 *      LONGER passed on-chain — they live in Supabase, written in step 6.
 *   3. Sign auth entries with the user's passkey via passkey-kit. The FaceID
 *      prompt fires inside this step.
 *   4. Re-simulate with the signed entries so the footprint covers the
 *      wallet's signer-storage reads (the initial sim ran without
 *      signatures so it never executed __check_auth).
 *   5. Rebuild the tx with the signed auth entries baked into a fresh
 *      InvokeHostFunction op (the JS-side `op.auth` mutations don't survive
 *      `Transaction.toXDR()`), sign envelope, submit.
 *   6. Decode the new Sobre contract address from the simulation result and
 *      insert a `public.family_wallets` row (carries the wallet display name).
 *      The `bootstrap_family_admin` trigger auto-inserts the matching
 *      `public.family_members` row with `role = 'admin'`. We then UPDATE that
 *      row with the admin's display name, and seed the three
 *      `family_envelope_names` rows with the chosen labels.
 *
 * Untyped indexed access on the Client is deliberate: `Client.from` returns a
 * generic Client and attaches the contract methods at runtime per the
 * on-chain spec. TypeScript can't see them without pre-generated bindings.
 */

export interface CreateFamilyArgs {
  /** Smart wallet C-address that will sign + become admin on chain. */
  myWalletContractId: string;
  /** Supabase `public.wallets.id` for the same wallet (created_by FK). */
  myWalletDbId: string;
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

interface CreateSobreInvocable {
  create_sobre: (params: {
    admin: string;
    payment_token: string;
  }) => Promise<contract.AssembledTransaction<string>>;
}

/** Convenience cast — the runtime AT carries a `simulationData` block but
 *  it's not on the public type. Local alias keeps the call sites tidy. */
type ATWithSim<T> = contract.AssembledTransaction<T> & {
  simulationData?: {
    result?: { retval?: import("@stellar/stellar-sdk").xdr.ScVal };
    transactionData?: unknown;
  };
};

export async function createFamilyWallet(
  args: CreateFamilyArgs,
): Promise<CreateFamilyResult> {
  const deployerAddress = getDeployerAddress();

  // Client.from fetches the factory's spec from chain. We pass the public
  // deployer G-address as `publicKey` so the AT builds against a real
  // funded account with a real sequence number. The smart wallet's
  // authorization is independent — it comes via auth entries signed by
  // the user's passkey, not the tx envelope signature.
  let factoryClient;
  try {
    factoryClient = await contract.Client.from({
      contractId: FACTORY_CONTRACT_ID,
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.rpcUrl,
      publicKey: deployerAddress,
    });
  } catch (err) {
    throw new Error(
      `[create_sobre step 1] Client.from failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const invocable = factoryClient as unknown as CreateSobreInvocable;
  let assembledTx: ATWithSim<string>;
  try {
    assembledTx = (await invocable.create_sobre({
      admin: args.myWalletContractId,
      payment_token: PAYMENT_TOKEN_SAC_ID,
    })) as ATWithSim<string>;
  } catch (err) {
    throw new Error(
      `[create_sobre step 2] build+simulate failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // FaceID prompt fires here. The returned AT carries the signed auth
  // entries; we MUST reassign — see signTransaction's docstring for the
  // instanceof-across-SDK-modules gotcha.
  try {
    assembledTx = (await signTransaction(assembledTx)) as ATWithSim<string>;
  } catch (err) {
    throw new Error(
      `[create_sobre step 3] passkey sign failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Re-simulate with the signed entries so the footprint covers the
  // wallet's signer-storage reads — the initial sim ran without
  // signatures so it never executed __check_auth.
  //
  // The simulate RPC's response carries auth entries too, and the SDK
  // applies them back to `.built.operations[0].auth` — wiping our signed
  // signatures with recording-mode empty ones. Capture and restore them
  // around the call so submit sees the actual passkey signature.
  const signedAuth = (
    assembledTx.built?.operations[0] as { auth?: unknown[] } | undefined
  )?.auth;
  // stellar-sdk 16 AT.simulate({restore:true}) hard-throws when the RPC
  // returns a restorePreamble unless the AT carries a signTransaction
  // option — which we can't wire up for a passkey-signed tx. Swallow
  // the specific restore-related throw and proceed; the submit-time
  // trap will surface a clearer error if archived state was actually
  // the issue.
  try {
    await assembledTx.simulate({ restore: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/signTransaction|restore|automatic restore/i.test(msg)) {
      throw new Error(
        `[create_sobre step 3b] re-simulate after sign failed: ${msg}`,
      );
    }
  }
  if (signedAuth && assembledTx.built) {
    (assembledTx.built.operations[0] as { auth?: unknown }).auth = signedAuth;
  }

  // Rebuild + submit. The shared `submitPasskeySigned` in passkey.ts handles
  // the JS-side `op.auth` → fresh-op + setSorobanData + envelope-sign dance.
  try {
    await submitPasskeySigned(assembledTx);
  } catch (err) {
    throw new Error(
      `[create_sobre step 4] rebuild+submit failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // The factory's `create_sobre` returns the new Sobre contract address.
  // The AT we got back from passkey-kit doesn't carry `parseResultXdr` (it
  // was rebuilt internally without our spec), so we decode the raw ScVal.
  let familyContractId: string;
  try {
    const retval = assembledTx.simulationData?.result?.retval;
    if (!retval) throw new Error("no simulation retval");
    familyContractId = Address.fromScVal(retval).toString();
    if (!familyContractId.startsWith("C")) {
      throw new Error(`unexpected result: ${familyContractId}`);
    }
  } catch (err) {
    throw new Error(
      `[create_sobre step 5] parsing result failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Enable Grow inline so the PDAX ramp works on first deposit — the
  // contract's `deposit_from_xlm` reads Blend + Soroswap addresses out
  // of Grow storage, and skipping this would strand any freshly-created
  // family at "PDAX credited, on-chain invoke panicked". Two FaceID
  // prompts back-to-back is the trade-off; the alternative (a separate
  // contract-side SwapConfig DataKey) would require a wasm redeploy for
  // what is architecturally the same pin. Families that never use Grow
  // just leave the bucket empty — enabling costs nothing beyond the fee.
  try {
    await invokeWrite(familyContractId, "grow_enable", [
      Address.fromString(args.myWalletContractId).toScVal(),
      Address.fromString(BLEND_POOL_ID).toScVal(),
      Address.fromString(XLM_SAC_ID).toScVal(),
      Address.fromString(SOROSWAP_ROUTER_ID).toScVal(),
    ]);
  } catch (err) {
    throw new Error(
      `[create_sobre step 6] auto-grow_enable failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Enable Earn too so onboarding-created Sobres match the dashboard
  // create path (useCreateSobre) — Savings yield on from day one. Gated on
  // EARN_AVAILABLE: earn_enable traps when the payment token can't back
  // MockUSDY, and a token flip must not brick onboarding.
  if (EARN_AVAILABLE) {
    try {
      await invokeWrite(familyContractId, "earn_enable", [
        Address.fromString(args.myWalletContractId).toScVal(),
        Address.fromString(MOCK_USDY_ID).toScVal(),
      ]);
    } catch (err) {
      throw new Error(
        `[create_sobre step 7] auto-earn_enable failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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
