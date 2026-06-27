"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";
import { rememberJoinedSobre } from "@/lib/joinedSobres";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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
 * `join_wallet(caller, invite_token)` on chain — the contract verifies
 * `sha256(invite_token)` was previously registered via `create_invite` by
 * the admin, hasn't expired, and hasn't already been redeemed.
 *
 * Display name + emoji are NOT sent to the contract anymore; we record them
 * in Supabase right after the on-chain join lands. This keeps cosmetic
 * renames free (no chain tx) and matches how create_sobre seeds admin
 * display data.
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
          xdr.ScVal.scvBytes(Buffer.from(inviteToken)),
        ];
        const { hash } = await invokeWrite(contractId, "join_wallet", args);

        // Local-state mirror of the on-chain membership — pairs with the
        // dashboard's `forgetJoinedSobre` cleanup when the user is later
        // kicked. Owning this here keeps the side-effect adjacent to the
        // mutation that justifies it.
        rememberJoinedSobre(userAddress, contractId);

        // Off-chain: insert a family_members row so display name + emoji
        // surface in dashboards and PDAX routes (requireFamilyMember)
        // recognise this user. Look up family_wallets.id + wallets.id by
        // the two contract addresses.
        const supabase = getSupabaseBrowserClient();
        const [{ data: walletRow }, { data: familyRow }] = await Promise.all([
          supabase
            .from("wallets")
            .select("id")
            .eq("contract_id", userAddress)
            .single(),
          supabase
            .from("family_wallets")
            .select("id")
            .eq("contract_id", contractId)
            .single(),
        ]);
        if (walletRow && familyRow) {
          await supabase.from("family_members").upsert(
            {
              family_wallet_id: (familyRow as { id: string }).id,
              wallet_id: (walletRow as { id: string }).id,
              role: "recipient",
              name,
              emoji,
            },
            { onConflict: "family_wallet_id,wallet_id" },
          );
        }

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
