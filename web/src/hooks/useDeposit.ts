"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseDepositResult {
  deposit: (amountStroops: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps the deposit(from, amount) contract call. Uses the connected user's
 * address as the `from` argument; their Freighter signature authorizes both
 * the outer Sobre call and the inner XLM SAC `transfer` sub-call.
 */
export function useDeposit(
  userAddress: string | null,
  contractId: string | null,
): UseDepositResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const deposit = useCallback(
    async (amountStroops: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(amountStroops, { type: "i128" }),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "deposit",
          args,
        );
        setLastHash(hash);
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress, contractId],
  );

  return { deposit, pending, error, lastHash };
}
