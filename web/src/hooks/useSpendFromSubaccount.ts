"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseSpendFromSubaccountResult {
  spend: (amountStroops: bigint, memo: string) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Sub-account holder self-spend. The contract verifies the caller is a
 * registered sub-account and refuses if admin has locked them. Tokens land
 * in caller's wallet; PDAX cashout completes from there.
 */
export function useSpendFromSubaccount(
  userAddress: string | null,
  contractId: string | null,
): UseSpendFromSubaccountResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const spend = useCallback(
    async (amountStroops: bigint, memo: string): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(amountStroops, { type: "i128" }),
          nativeToScVal(memo, { type: "string" }),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "spend_from_subaccount",
          args,
        );
        setLastHash(hash);
        return hash;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress, contractId],
  );

  return { spend, pending, error, lastHash };
}
