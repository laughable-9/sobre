"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { XLM_SAC_ID } from "@/lib/config";
import { invokeWrite } from "@/lib/contract";

export interface InitArgs {
  walletName: string;
  adminName: string;
  adminEmoji: string;
  percents?: [number, number, number];
}

export interface UseInitResult {
  init: (args: InitArgs) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Calls Sobre's
 *   init(admin, payment_token, percents, wallet_name, admin_name, admin_emoji)
 * using the connected user as the admin. The admin's Freighter signature
 * authorizes the init call AND seeds them as the first profiled member with
 * (admin_name, admin_emoji). Only callable once per contract instance.
 */
export function useInit(userAddress: string | null): UseInitResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(
    async ({
      walletName,
      adminName,
      adminEmoji,
      percents = [50, 30, 20],
    }: InitArgs): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(XLM_SAC_ID).toScVal(),
          xdr.ScVal.scvVec(percents.map((p) => xdr.ScVal.scvU32(p))),
          xdr.ScVal.scvString(walletName),
          xdr.ScVal.scvString(adminName),
          xdr.ScVal.scvString(adminEmoji),
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
