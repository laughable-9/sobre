"use client";

import { useCallback, useState } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseCancelGrowWithdrawalResult {
  cancel: (requestId: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `cancel_grow_withdrawal(request_id)`. Clears the request; funds
 * stay in the Grow bucket. Freed reservation lets the requester queue a
 * fresh request whenever they want (starting a new 48h timer).
 */
export function useCancelGrowWithdrawal(
  userAddress: string | null,
  contractId: string | null,
): UseCancelGrowWithdrawalResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const cancel = useCallback(
    async (requestId: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [nativeToScVal(requestId, { type: "u64" })];
        const { hash } = await invokeWrite(
          contractId,
          "cancel_grow_withdrawal",
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

  return { cancel, pending, error, lastHash };
}
