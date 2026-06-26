"use client";

import { useCallback, useState } from "react";

import { invokeWrite, percentsScVal } from "@/lib/contract";

export interface UseSetEnvelopesResult {
  setEnvelopes: (percents: [number, number, number]) => Promise<string>;
  pending: boolean;
  error: string | null;
}

export function useSetEnvelopes(
  adminAddress: string | null,
  contractId: string | null,
): UseSetEnvelopesResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setEnvelopes = useCallback(
    async (percents: [number, number, number]): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const { hash } = await invokeWrite(
          contractId,
          "set_envelopes",
          [percentsScVal(percents)],
        );
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

  return { setEnvelopes, pending, error };
}
