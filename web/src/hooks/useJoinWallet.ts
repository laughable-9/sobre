"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";
import { rememberJoinedSobre } from "@/lib/joinedSobres";
import { makeMarkerSlot } from "@/lib/pendingMutation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Marker checkpoint. Presence means `join_wallet` already landed on chain
 *  for this (user, contract) pair; the retry should skip the on-chain call
 *  (which traps with "already member") and re-run only the Supabase mirror
 *  writes below. */
const joinSlot = makeMarkerSlot("sobre.pendingJoin");

export interface UseJoinWalletResult {
  /** `inviteToken` is the 32-byte plaintext token from the invite URL,
   *  base64url-decoded by the caller. */
  joinWallet: (
    name: string,
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
 * Display name is NOT sent to the contract anymore; we record it in
 * Supabase right after the on-chain join lands. This keeps cosmetic
 * renames free (no chain tx) and matches how create_sobre seeds admin
 * display data. Avatar images come from the joiner's Google OAuth profile
 * on the wallets row — no per-member picture is stored on family_members.
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
        // Owner key includes contractId so a user with multiple in-flight
        // joins across different families doesn't collide checkpoints.
        const slotOwner = `${userAddress}:${contractId}`;
        const resumed = joinSlot.read(slotOwner);
        let hash = "";
        if (!resumed) {
          const args = [
            Address.fromString(userAddress).toScVal(),
            xdr.ScVal.scvBytes(Buffer.from(inviteToken)),
          ];
          ({ hash } = await invokeWrite(contractId, "join_wallet", args));
          // Checkpoint immediately so a Supabase failure below is
          // recoverable — a second `join_wallet` would trap and strand
          // the user with on-chain membership but no family_members row.
          joinSlot.write(slotOwner, true);
        }

        // Local-state mirror of the on-chain membership — pairs with the
        // dashboard's `forgetJoinedSobre` cleanup when the user is later
        // kicked. Idempotent (dedupes via `includes`), safe on resume.
        rememberJoinedSobre(userAddress, contractId);

        // Off-chain: insert a family_members row so display name surfaces
        // in dashboards and PDAX routes (requireFamilyMember) recognise
        // this user.
        //
        // The "Recipients can self-join via invite" RLS policy gates the
        // insert: role must be 'recipient' and wallet_id must be the
        // caller's own. Errors are surfaced (previously swallowed) so a
        // failed mirror doesn't leave the user with on-chain membership
        // but no Supabase row.
        const supabase = getSupabaseBrowserClient();
        const [walletQ, familyQ] = await Promise.all([
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
        if (walletQ.error || !walletQ.data) {
          throw new Error(
            `Joined on chain but couldn't resolve your wallet record: ${walletQ.error?.message ?? "missing"}`,
          );
        }
        if (familyQ.error || !familyQ.data) {
          throw new Error(
            `Joined on chain but couldn't resolve the family record: ${familyQ.error?.message ?? "missing"}`,
          );
        }
        const { error: upsertErr } = await supabase
          .from("family_members")
          .upsert(
            {
              family_wallet_id: (familyQ.data as { id: string }).id,
              wallet_id: (walletQ.data as { id: string }).id,
              role: "recipient",
              name,
            },
            { onConflict: "family_wallet_id,wallet_id" },
          );
        if (upsertErr) {
          throw new Error(
            `Joined on chain but Supabase mirror failed: ${upsertErr.message}`,
          );
        }
        joinSlot.clear(slotOwner);

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
