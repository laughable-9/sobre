"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeAdminWithFallback } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export interface UseEarnWithdrawResult {
  withdraw: (envelope: EnvelopeName, amountStroops: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `earn_withdraw(envelope, amount)`. Pulls `amount` XLM stroops out
 * of the envelope's Blend position back into its spendable balance.
 * Contract enforces admin auth + envelope-attribution invariant (a withdraw
 * that would burn more shares than the envelope holds panics with #21).
 */
export function useEarnWithdraw(
  userAddress: string | null,
  contractId: string | null,
): UseEarnWithdrawResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const withdraw = useCallback(
    async (envelope: EnvelopeName, amountStroops: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (amountStroops <= 0n) throw new Error("Amount must be positive.");
      setPending(true);
      setError(null);
      try {
        const { hash } = await invokeAdminWithFallback(
          contractId,
          "earn_withdraw",
          Address.fromString(userAddress).toScVal(),
          [
            envelopeScVal(envelope),
            nativeToScVal(amountStroops, { type: "i128" }),
          ],
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

  return { withdraw, pending, error, lastHash };
}
