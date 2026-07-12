"use client";

import { useCallback } from "react";
import { Address } from "@stellar/stellar-sdk";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { FACTORY_CONTRACT_ID, PAYMENT_TOKEN_SAC_ID } from "@/lib/config";
import { invokeWrite } from "@/lib/contract";
import { mirrorFamilyCreate } from "@/lib/familyWallets";

export interface CreateSobreArgs {
  walletName: string;
  adminName: string;
  percents?: [number, number, number];
  envelopeNames?: [string, string, string];
}

export interface UseCreateSobreResult {
  createSobre: (args: CreateSobreArgs) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Calls SobreFactory.create_sobre to deploy + init a new per-family Sobre
 * instance in one transaction, then POSTs to /api/family/create which
 * mirrors the family into Supabase after verifying the caller is the
 * on-chain admin of the new wallet.
 *
 * Mirroring used to be a direct client-side `family_wallets.insert(...)`,
 * which let an attacker squat on a predicted contract address. The
 * server-side check via `get_state().admin` closes that.
 */
export function useCreateSobre(
  userAddress: string | null,
): UseCreateSobreResult {
  const mutation = useCallback(
    async ({
      walletName,
      adminName,
      percents = [50, 30, 20],
      envelopeNames = ["Groceries", "Tuition", "Savings"],
    }: CreateSobreArgs): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      const args = [
        Address.fromString(userAddress).toScVal(),
        Address.fromString(PAYMENT_TOKEN_SAC_ID).toScVal(),
      ];
      const { returnValue } = await invokeWrite(
        FACTORY_CONTRACT_ID,
        "create_sobre",
        args,
      );
      if (typeof returnValue !== "string") {
        throw new Error("create_sobre returned no contract address");
      }
      const newContractId = returnValue;
      await mirrorFamilyCreate({
        contractId: newContractId,
        displayName: walletName,
        percents,
        adminName,
        envelopeNames,
      });
      return newContractId;
    },
    [userAddress],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { createSobre: run, pending, error };
}
