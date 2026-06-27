"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export interface UseFundSubaccountResult {
  fund: (
    envelope: EnvelopeName,
    recipient: string,
    amountStroops: bigint,
  ) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Admin tops up a sub-account from one envelope. Internal ledger transfer
 * inside the family contract: debits the envelope, credits the recipient's
 * sub-account balance. No tokens leave the contract.
 */
export function useFundSubaccount(
  adminAddress: string | null,
  contractId: string | null,
): UseFundSubaccountResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const fund = useCallback(
    async (
      envelope: EnvelopeName,
      recipient: string,
      amountStroops: bigint,
    ): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          envelopeScVal(envelope),
          Address.fromString(recipient).toScVal(),
          nativeToScVal(amountStroops, { type: "i128" }),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "fund_subaccount",
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
    [adminAddress, contractId],
  );

  return { fund, pending, error, lastHash };
}
