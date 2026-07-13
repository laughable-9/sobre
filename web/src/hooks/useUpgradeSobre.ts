"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseUpgradeSobreResult {
  upgrade: () => Promise<string>;
  pending: boolean;
  error: string | null;
}

/** Admin-only. Calls SobreContract.upgrade(), which reads the factory's
 *  current_sobre_wasm and swaps this instance's wasm in place. */
export function useUpgradeSobre(
  adminAddress: string | null,
  contractId: string | null,
): UseUpgradeSobreResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upgrade = useCallback(async (): Promise<string> => {
    if (!adminAddress) throw new Error("Wallet not connected.");
    if (!contractId) throw new Error("No wallet selected.");
    setPending(true);
    setError(null);
    try {
      const { hash } = await invokeWrite(
        contractId,
        "upgrade",
        [Address.fromString(adminAddress).toScVal()],
      );
      return hash;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setPending(false);
    }
  }, [adminAddress, contractId]);

  return { upgrade, pending, error };
}
