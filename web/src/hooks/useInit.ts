"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { XLM_SAC_ID } from "@/lib/config";
import { invokeWrite } from "@/lib/contract";

export interface UseInitResult {
  init: (percents?: [number, number, number]) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Calls Sobre's init(admin, payment_token, percents) using the connected
 * user as the admin. Their Freighter signature authorizes the init call.
 * Only callable once per contract instance (subsequent calls panic
 * AlreadyInitialized).
 */
export function useInit(userAddress: string | null): UseInitResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(
    async (
      percents: [number, number, number] = [50, 30, 20],
    ): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(XLM_SAC_ID).toScVal(),
          xdr.ScVal.scvVec(percents.map((p) => xdr.ScVal.scvU32(p))),
        ];
        return await invokeWrite("init", args, userAddress);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress],
  );

  return { init, pending, error };
}
