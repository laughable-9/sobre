"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseRemoveMemberResult {
  removeMember: (memberAddress: string) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/** Admin-only kick. Caller must be the admin's wallet. */
export function useRemoveMember(
  adminAddress: string | null,
): UseRemoveMemberResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeMember = useCallback(
    async (memberAddress: string): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const args = [Address.fromString(memberAddress).toScVal()];
        return await invokeWrite("remove_member", args, adminAddress);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  return { removeMember, pending, error };
}
