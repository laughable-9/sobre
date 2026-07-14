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
      // Try the v11 signature first (upgrade takes caller: Address).
      // Pre-v11 wallets' upgrade takes no args and will trap on
      // MismatchingParameterLen — catch that specific case and retry
      // with the 0-arg shape so the user only pays one passkey prompt
      // regardless of which wasm the wallet is currently running.
      try {
        const { hash } = await invokeWrite(
          contractId,
          "upgrade",
          [Address.fromString(adminAddress).toScVal()],
        );
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("MismatchingParameterLen")) throw e;
        const { hash } = await invokeWrite(contractId, "upgrade", []);
        return hash;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setPending(false);
    }
  }, [adminAddress, contractId]);

  return { upgrade, pending, error };
}
