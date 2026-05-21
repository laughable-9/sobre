"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseJoinWalletResult {
  joinWallet: (name: string, emoji: string) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Self-service join used by the invite-link flow. The connected wallet calls
 * join_wallet(caller, name, emoji) — anyone with the URL can do this until
 * the 2-member cap is reached.
 */
export function useJoinWallet(
  userAddress: string | null,
): UseJoinWalletResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinWallet = useCallback(
    async (name: string, emoji: string): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          xdr.ScVal.scvString(name),
          xdr.ScVal.scvString(emoji),
        ];
        return await invokeWrite("join_wallet", args, userAddress);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress],
  );

  return { joinWallet, pending, error };
}
