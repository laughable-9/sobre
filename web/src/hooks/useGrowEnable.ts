"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { BLEND_POOL_ID, SOROSWAP_ROUTER_ID, XLM_SAC_ID } from "@/lib/config";
import { invokeAdminWithFallback } from "@/lib/contract";

export interface UseGrowEnableResult {
  enable: () => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `grow_enable(pool, xlm_asset, soroswap_router)` — v9 signature.
 * Pins the Blend pool, XLM SAC (Blend's reserve asset), and Soroswap
 * router the contract will use for the USDC↔XLM swap sandwich around
 * every Grow supply/withdraw. Also required by `deposit_from_xlm`
 * (server-side PDAX ramp) — a wallet must have Grow enabled before its
 * first PDAX deposit will succeed. One-shot per wallet.
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
      const { hash } = await invokeAdminWithFallback(
        contractId,
        "grow_enable",
        Address.fromString(userAddress).toScVal(),
        [
          Address.fromString(BLEND_POOL_ID).toScVal(),
          Address.fromString(XLM_SAC_ID).toScVal(),
          Address.fromString(SOROSWAP_ROUTER_ID).toScVal(),
        ],
      );
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
