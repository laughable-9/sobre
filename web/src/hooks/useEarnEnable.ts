"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { MOCK_USDY_ID } from "@/lib/config";
import { invokeWrite } from "@/lib/contract";

export interface UseEarnEnableResult {
  enable: () => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `earn_enable(usdy_contract)` — v9 signature. Admin points the
 * wallet at a USDY-shaped token contract (MockUSDY on testnet, real Ondo
 * USDY once it ships on Stellar). One-shot per wallet — the contract
 * rejects a second call.
 *
 * The USDY contract's `underlying()` must equal the wallet's payment
 * token; a mismatch traps here rather than at the first supply.
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
      const args = [Address.fromString(MOCK_USDY_ID).toScVal()];
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
