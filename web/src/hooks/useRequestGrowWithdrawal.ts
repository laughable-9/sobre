"use client";

import { useCallback, useState } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseRequestGrowWithdrawalResult {
  request: (amountStroops: bigint) => Promise<{ hash: string; id: bigint }>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `request_grow_withdrawal(amount) -> u64`. Reserves the amount
 * against GrowBalance and stamps `unlock_at = now + 48h`. Returns both
 * the tx hash and the assigned request id so the caller can address it
 * for a later execute/cancel.
 */
export function useRequestGrowWithdrawal(
  userAddress: string | null,
  contractId: string | null,
): UseRequestGrowWithdrawalResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const request = useCallback(
    async (amountStroops: bigint) => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (amountStroops <= 0n) throw new Error("Amount must be positive.");
      setPending(true);
      setError(null);
      try {
        const args = [nativeToScVal(amountStroops, { type: "i128" })];
        const { hash, returnValue } = await invokeWrite(
          contractId,
          "request_grow_withdrawal",
          args,
        );
        setLastHash(hash);
        const id =
          typeof returnValue === "bigint"
            ? returnValue
            : BigInt(String(returnValue ?? 0));
        return { hash, id };
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

  return { request, pending, error, lastHash };
}
