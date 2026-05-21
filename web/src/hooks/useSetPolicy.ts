"use client";

import { useCallback, useState } from "react";

import { invokeWrite, spendPolicyScVal } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export interface PolicyInput {
  requireAllSigs: boolean;
  dailyLimit: bigint | null;
  protectedEnvelopes: EnvelopeName[];
}

export interface UseSetPolicyResult {
  setPolicy: (input: PolicyInput) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/** Any spend that lands after this call evaluates against the new policy. */
export function useSetPolicy(
  adminAddress: string | null,
  contractId: string | null,
): UseSetPolicyResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const setPolicy = useCallback(
    async (input: PolicyInput): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [spendPolicyScVal(input)];
        const { hash } = await invokeWrite(
          contractId,
          "set_policy",
          args,
          adminAddress,
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

  return { setPolicy, pending, error, lastHash };
}
