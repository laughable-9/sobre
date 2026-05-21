"use client";

import { useCallback, useState } from "react";

import { invokeWrite } from "@/lib/contract";

export interface UseCloseWalletResult {
  closeWallet: () => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Admin-only. Sweeps every envelope balance back to admin and zeroes the
 * envelopes in one call. Wallet stays callable but functionally empty —
 * re-depositing would still trigger the auto-split, so this is the "close
 * out" action, not a contract self-destruct.
 */
export function useCloseWallet(
  adminAddress: string | null,
): UseCloseWalletResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeWallet = useCallback(async (): Promise<string> => {
    if (!adminAddress) throw new Error("Wallet not connected.");
    setPending(true);
    setError(null);
    try {
      return await invokeWrite("close_wallet", [], adminAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setPending(false);
    }
  }, [adminAddress]);

  return { closeWallet, pending, error };
}
