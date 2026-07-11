"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { BLEND_ASSET_ID, BLEND_POOL_ID } from "@/lib/config";
import { invokeWrite } from "@/lib/contract";

export interface UseEarnEnableResult {
  enable: () => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `earn_enable(pool, asset)`. One-shot per wallet — the contract
 * rejects a second call. Admin auth required (contract enforces via
 * require_admin_auth). Pool and asset are hardcoded per the demo network
 * config; a future USDC-yield promotion updates them in `lib/config.ts`.
 */
export function useEarnEnable(
  userAddress: string | null,
  contractId: string | null,
): UseEarnEnableResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const enable = useCallback(async (): Promise<string> => {
    if (!userAddress) throw new Error("Wallet not connected.");
    if (!contractId) throw new Error("No wallet selected.");
    setPending(true);
    setError(null);
    try {
      const args = [
        Address.fromString(BLEND_POOL_ID).toScVal(),
        Address.fromString(BLEND_ASSET_ID).toScVal(),
      ];
      const { hash } = await invokeWrite(contractId, "earn_enable", args);
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
