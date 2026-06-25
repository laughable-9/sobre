"use client";

import { useCallback, useState } from "react";
import { xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";

export interface UseRenameWalletResult {
  renameWallet: (newName: string) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/** Admin-only. Renames the wallet (the string in the top bar both members see). */
export function useRenameWallet(
  adminAddress: string | null,
  contractId: string | null,
): UseRenameWalletResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renameWallet = useCallback(
    async (newName: string): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const args = [xdr.ScVal.scvString(newName)];
        const { hash } = await invokeWrite(
          contractId,
          "set_wallet_name",
          args,
        );
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

  return { renameWallet, pending, error };
}
