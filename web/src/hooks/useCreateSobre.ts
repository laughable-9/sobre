"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { FACTORY_CONTRACT_ID, XLM_SAC_ID } from "@/lib/config";
import { invokeWrite, percentsScVal, stringVecScVal } from "@/lib/contract";

export interface CreateSobreArgs {
  walletName: string;
  adminName: string;
  adminEmoji: string;
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
 * instance in one transaction. Returns the address of the freshly-deployed
 * SobreContract — pulled from the tx's returnValue, which invokeWrite
 * already decodes for us during the inclusion poll.
 */
export function useCreateSobre(
  userAddress: string | null,
): UseCreateSobreResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSobre = useCallback(
    async ({
      walletName,
      adminName,
      adminEmoji,
      percents = [50, 30, 20],
      envelopeNames = ["Groceries", "Tuition", "Savings"],
    }: CreateSobreArgs): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(XLM_SAC_ID).toScVal(),
          percentsScVal(percents),
          stringVecScVal(envelopeNames),
          xdr.ScVal.scvString(walletName),
          xdr.ScVal.scvString(adminName),
          xdr.ScVal.scvString(adminEmoji),
        ];
        const { returnValue } = await invokeWrite(
          FACTORY_CONTRACT_ID,
          "create_sobre",
          args,
        );
        if (typeof returnValue !== "string") {
          throw new Error("create_sobre returned no contract address");
        }
        return returnValue;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress],
  );

  return { createSobre, pending, error };
}
