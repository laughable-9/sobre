"use client";

import { useCallback, useState } from "react";
import { xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseSetEnvelopeNamesResult {
  setEnvelopeNames: (names: [string, string, string]) => Promise<string>;
  pending: boolean;
  error: string | null;
}

export function useSetEnvelopeNames(
  adminAddress: string | null,
  contractId: string | null,
): UseSetEnvelopeNamesResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setEnvelopeNames = useCallback(
    async (names: [string, string, string]): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          xdr.ScVal.scvVec(names.map((n) => xdr.ScVal.scvString(n))),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "set_envelope_names",
          args,
          adminAddress,
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

  return { setEnvelopeNames, pending, error };
}
