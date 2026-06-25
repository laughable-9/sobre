"use client";

import { Address, contract } from "@stellar/stellar-sdk";

import { FACTORY_CONTRACT_ID, NETWORK, XLM_SAC_ID } from "@/lib/config";
import {
  getDeployerAddress,
  signTransaction,
  submitPasskeySigned,
} from "@/lib/passkey";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Phase 5 family-wallet creation flow.
 *
 *   1. Load the factory contract's spec from chain (one network round-trip).
 *   2. Build an AssembledTransaction for `create_sobre(admin, ...)` with the
 *      caller's smart wallet C-address as admin.
 *   3. Sign auth entries with the user's passkey via passkey-kit. The FaceID
 *      prompt fires inside this step.
 *   4. Re-simulate with the signed entries so the footprint covers the
 *      wallet's signer-storage reads (the initial sim ran without
 *      signatures so it never executed __check_auth).
 *   5. Rebuild the tx with the signed auth entries baked into a fresh
 *      InvokeHostFunction op (the JS-side `op.auth` mutations don't survive
 *      `Transaction.toXDR()`), sign envelope, submit.
 *   6. Decode the new Sobre contract address from the simulation result and
 *      insert a `public.family_wallets` row. The `bootstrap_family_admin`
 *      trigger auto-inserts the matching `public.family_members` row with
 *      `role = 'admin'`.
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
  percents: readonly [number, number, number];
  /** Display name written to family_wallets.display_name. */
  walletName: string;
  adminName: string;
  adminEmoji: string;
}

export interface CreateFamilyResult {
  familyContractId: string;
  familyWalletId: string;
}

interface CreateSobreInvocable {
  create_sobre: (params: {
    admin: string;
    payment_token: string;
    percents: number[];
    envelope_names: string[];
    wallet_name: string;
    admin_name: string;
    admin_emoji: string;
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
  const supabase = getSupabaseBrowserClient();
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
      payment_token: XLM_SAC_ID,
      percents: [...args.percents],
      envelope_names: [...args.envelopeNames],
      wallet_name: args.walletName,
      admin_name: args.adminName,
      admin_emoji: args.adminEmoji,
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
  try {
    await assembledTx.simulate({ restore: false });
  } catch (err) {
    throw new Error(
      `[create_sobre step 3b] re-simulate after sign failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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

  const { data: row, error: insertErr } = await supabase
    .from("family_wallets")
    .insert({
      contract_id: familyContractId,
      display_name: args.walletName,
      created_by: args.myWalletDbId,
    })
    .select("id")
    .single();

  if (insertErr) {
    throw new Error(`family_wallets insert failed: ${insertErr.message}`);
  }

  return {
    familyContractId,
    familyWalletId: row.id,
  };
}

/** "Kyle Pagunsan" → "The Pagunsan Family". Falls back to "Sobre Family"
 *  when the name doesn't split into recognisable parts. */
export function deriveFamilyName(fullName: string | null | undefined): string {
  if (!fullName) return "Sobre Family";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? `The ${last} Family` : "Sobre Family";
}
