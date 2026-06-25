"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";
import { rememberJoinedSobre } from "@/lib/joinedSobres";

export interface UseJoinWalletResult {
  /** `inviteToken` is the 32-byte plaintext token from the invite URL,
   *  base64url-decoded by the caller. */
  joinWallet: (
    name: string,
    emoji: string,
    inviteToken: Uint8Array,
  ) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Self-service join used by the invite-link flow. The connected wallet calls
 * join_wallet(caller, name, emoji, invite_token) — the contract verifies
 * `sha256(invite_token)` was previously registered via `create_invite` by
 * the admin, hasn't expired, and hasn't already been redeemed.
 */
export function useJoinWallet(
  userAddress: string | null,
  contractId: string | null,
): UseJoinWalletResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinWallet = useCallback(
    async (
      name: string,
      emoji: string,
      inviteToken: Uint8Array,
    ): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (inviteToken.length !== 32) {
        throw new Error("Invite token must be 32 bytes.");
      }
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          xdr.ScVal.scvString(name),
          xdr.ScVal.scvString(emoji),
          xdr.ScVal.scvBytes(Buffer.from(inviteToken)),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "join_wallet",
          args,
        );
        // Local-state mirror of the on-chain membership — pairs with the
        // dashboard's `forgetJoinedSobre` cleanup when the user is later
        // kicked. Owning this here keeps the side-effect adjacent to the
        // mutation that justifies it.
        rememberJoinedSobre(userAddress, contractId);
        return hash;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress, contractId],
  );

  return { joinWallet, pending, error };
}
