"use client";

import { useCallback, useState } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export interface UseEarnSupplyResult {
  supply: (envelope: EnvelopeName, amountStroops: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `earn_supply(envelope, amount)`. Moves `amount` XLM stroops from
 * the envelope's spendable balance into the Blend pool as bTokens attributed
 * to that envelope. Contract enforces admin auth + balance sufficiency.
 */
export function useEarnSupply(
  userAddress: string | null,
  contractId: string | null,
): UseEarnSupplyResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const supply = useCallback(
    async (envelope: EnvelopeName, amountStroops: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (amountStroops <= 0n) throw new Error("Amount must be positive.");
      setPending(true);
      setError(null);
      try {
        const args = [
          envelopeScVal(envelope),
          nativeToScVal(amountStroops, { type: "i128" }),
        ];
        const { hash } = await invokeWrite(contractId, "earn_supply", args);
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

  return { supply, pending, error, lastHash };
}
