"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export interface UseSpendResult {
  spend: (
    envelope: EnvelopeName,
    amountStroops: bigint,
    memo: string,
  ) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps the spend(caller, envelope, amount, memo) contract call. Caller is
 * the connected user. Contract verifies caller is in the wallet's member
 * list and that the envelope has enough balance.
 */
export function useSpend(
  userAddress: string | null,
  contractId: string | null,
): UseSpendResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const spend = useCallback(
    async (
      envelope: EnvelopeName,
      amountStroops: bigint,
      memo: string,
    ): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          envelopeScVal(envelope),
          nativeToScVal(amountStroops, { type: "i128" }),
          nativeToScVal(memo, { type: "string" }),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "spend",
          args,
          userAddress,
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

  return { spend, pending, error, lastHash };
}
