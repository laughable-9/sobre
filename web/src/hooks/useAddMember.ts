"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseAddMemberResult {
  addMember: (memberAddress: string) => Promise<string>;
  pending: boolean;
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps the admin-only add_member(member) contract call. The connected user
 * must be the admin — non-admin signatures will fail at require_admin_auth.
 * The contract caps total members at MAX_MEMBERS (2 for the demo: admin + one).
 */
export function useAddMember(adminAddress: string | null): UseAddMemberResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const addMember = useCallback(
    async (memberAddress: string): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const memberScVal = Address.fromString(
          memberAddress.trim(),
        ).toScVal();
        const hash = await invokeWrite(
          "add_member",
          [memberScVal],
          adminAddress,
        );
        setLastHash(hash);
        return hash;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  return { addMember, pending, error, lastHash };
}
