"use client";

import { contract } from "@stellar/stellar-sdk";

import { FACTORY_CONTRACT_ID, NETWORK, XLM_SAC_ID } from "@/lib/config";
import { getPasskeyKit } from "@/lib/passkey";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Phase 5 family-wallet creation flow.
 *
 *   1. Load the factory contract's spec from chain (one network round-trip).
 *   2. Build an AssembledTransaction for `create_sobre(admin, ...)` with the
 *      caller's smart wallet C-address as admin.
 *   3. Sign + re-simulate + submit via smart-account-kit. The user's passkey
 *      prompt fires here; the kit fee-bumps via the SDK's direct-RPC path
 *      (no Channels relayer on testnet).
 *   4. Read the new Sobre contract's C-address from the parsed result.
 *   5. Insert a `public.family_wallets` row. The `bootstrap_family_admin`
 *      trigger auto-inserts the matching `public.family_members` row with
 *      `role = 'admin'`, so the creator becomes the on-chain *and* off-chain
 *      admin in a single round-trip.
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

export async function createFamilyWallet(
  args: CreateFamilyArgs,
): Promise<CreateFamilyResult> {
  const supabase = getSupabaseBrowserClient();
  const kit = await getPasskeyKit();

  // No publicKey: the SDK falls back to the NULL_ACCOUNT sentinel for
  // simulation, then kit.signAndSubmit swaps in its own deployer keypair for
  // the actual submit. Passing the smart wallet C-address here would fail
  // address validation (C-addresses fail the strkey ed25519 version check).
  let factoryClient;
  try {
    factoryClient = await contract.Client.from({
      contractId: FACTORY_CONTRACT_ID,
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.rpcUrl,
    });
  } catch (err) {
    throw new Error(
      `[create_sobre step 1] Client.from failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const invocable = factoryClient as unknown as CreateSobreInvocable;
  let assembledTx: contract.AssembledTransaction<string>;
  try {
    assembledTx = await invocable.create_sobre({
      admin: args.myWalletContractId,
      payment_token: XLM_SAC_ID,
      percents: [...args.percents],
      envelope_names: [...args.envelopeNames],
      wallet_name: args.walletName,
      admin_name: args.adminName,
      admin_emoji: args.adminEmoji,
    });
  } catch (err) {
    throw new Error(
      `[create_sobre step 2] build+simulate failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let submitResult;
  try {
    submitResult = await kit.signAndSubmit(assembledTx);
  } catch (err) {
    throw new Error(
      `[create_sobre step 3] signAndSubmit threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!submitResult.success) {
    throw new Error(
      `[create_sobre step 3] signAndSubmit returned error: ${submitResult.error ?? "unknown"}`,
    );
  }

  let familyContractId: unknown;
  try {
    familyContractId = assembledTx.result;
  } catch (err) {
    throw new Error(
      `[create_sobre step 4] parsing result failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof familyContractId !== "string" || !familyContractId.startsWith("C")) {
    throw new Error(
      `[create_sobre step 4] unexpected result shape: ${JSON.stringify(familyContractId)}`,
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
