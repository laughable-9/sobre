"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseToggleSubaccountLockResult {
  toggle: (subaccount: string, currentlyLocked: boolean) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Admin flips a sub-account between locked and unlocked. Routes to
 * lock_subaccount / unlock_subaccount based on the current state — one
 * passkey prompt per flip.
 */
export function useToggleSubaccountLock(
  adminAddress: string | null,
  contractId: string | null,
): UseToggleSubaccountLockResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const toggle = useCallback(
    async (subaccount: string, currentlyLocked: boolean): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const method = currentlyLocked ? "unlock_subaccount" : "lock_subaccount";
        const args = [
          Address.fromString(adminAddress).toScVal(),
          Address.fromString(subaccount).toScVal(),
        ];
        const { hash } = await invokeWrite(contractId, method, args);
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

  return { toggle, pending, error, lastHash };
}
