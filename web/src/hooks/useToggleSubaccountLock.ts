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
        const callerScVal = Address.fromString(adminAddress).toScVal();
        const subaccountScVal = Address.fromString(subaccount).toScVal();
        // v11 signature: lock_subaccount(caller, subaccount). v10 was
        // lock_subaccount(subaccount) — a wallet that hasn't run
        // upgrade() yet still expects one arg. Simulate v11 first;
        // fall back to the v10 shape on MismatchingParameterLen.
        // Simulation catches the shape mismatch before any passkey
        // prompt, so the user only signs once regardless.
        let hash: string;
        try {
          ({ hash } = await invokeWrite(contractId, method, [
            callerScVal,
            subaccountScVal,
          ]));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("MismatchingParameterLen")) throw e;
          ({ hash } = await invokeWrite(contractId, method, [
            subaccountScVal,
          ]));
        }
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
