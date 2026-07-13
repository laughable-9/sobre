"use client";

import { useCallback, useState } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseExecuteGrowWithdrawalResult {
  execute: (requestId: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `execute_grow_withdrawal(request_id)`. Only valid after the
 * request's `unlock_at` has passed; before that the contract traps with
 * error 25 (GrowTimelockNotElapsed). Transfers the request's amount from
 * the Grow bucket to the requester's wallet and clears the request.
 */
export function useExecuteGrowWithdrawal(
  userAddress: string | null,
  contractId: string | null,
): UseExecuteGrowWithdrawalResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const execute = useCallback(
    async (requestId: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [nativeToScVal(requestId, { type: "u64" })];
        const { hash } = await invokeWrite(
          contractId,
          "execute_grow_withdrawal",
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

  return { execute, pending, error, lastHash };
}
