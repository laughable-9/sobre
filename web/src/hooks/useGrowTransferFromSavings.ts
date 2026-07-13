"use client";

import { useCallback, useState } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseGrowTransferFromSavingsResult {
  transfer: (amountStroops: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `grow_transfer_from_savings(amount)`. Internal ledger move —
 * debits Balances[Savings], credits GrowBalance. No token leaves the
 * contract. Admin auth required.
 */
export function useGrowTransferFromSavings(
  userAddress: string | null,
  contractId: string | null,
): UseGrowTransferFromSavingsResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const transfer = useCallback(
    async (amountStroops: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (amountStroops <= 0n) throw new Error("Amount must be positive.");
      setPending(true);
      setError(null);
      try {
        const args = [nativeToScVal(amountStroops, { type: "i128" })];
        const { hash } = await invokeWrite(
          contractId,
          "grow_transfer_from_savings",
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

  return { transfer, pending, error, lastHash };
}
