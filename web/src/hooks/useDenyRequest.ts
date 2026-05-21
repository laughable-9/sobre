"use client";

import { useCallback, useState } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseDenyRequestResult {
  deny: (requestId: bigint) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/** Drops the queued spend; no tokens move. */
export function useDenyRequest(
  adminAddress: string | null,
  contractId: string | null,
): UseDenyRequestResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const deny = useCallback(
    async (requestId: bigint): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [nativeToScVal(requestId, { type: "u64" })];
        const { hash } = await invokeWrite(
          contractId,
          "deny_request",
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

  return { deny, pending, error, lastHash };
}
