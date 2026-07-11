"use client";

import { useCallback, useState } from "react";

import { invokeWrite } from "@/lib/contract";

export interface UseGrowEnableResult {
  enable: () => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `grow_enable()`. One-shot per wallet — the contract rejects a
 * second call. Admin auth required.
 */
export function useGrowEnable(
  userAddress: string | null,
  contractId: string | null,
): UseGrowEnableResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const enable = useCallback(async (): Promise<string> => {
    if (!userAddress) throw new Error("Wallet not connected.");
    if (!contractId) throw new Error("No wallet selected.");
    setPending(true);
    setError(null);
    try {
      const { hash } = await invokeWrite(contractId, "grow_enable", []);
      setLastHash(hash);
      return hash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setPending(false);
    }
  }, [userAddress, contractId]);

  return { enable, pending, error, lastHash };
}
