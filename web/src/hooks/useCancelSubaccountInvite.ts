"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";
import { hexToBytes } from "@/lib/encoding";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UseCancelSubaccountInviteResult {
  /** Cancels one pending sub-account invite: on-chain hash removal +
   *  Supabase row delete + caller-side refresh. Returns nothing on
   *  success; throws on chain error or Supabase error. */
  cancel: (inviteTokenHashHex: string) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/**
 * Admin-only. Reverses a `create_subaccount_invite` — nukes the on-chain
 * hash so nobody holding the plaintext can redeem it, then removes the
 * corresponding `family_subaccounts` row (identified by
 * `invite_token_hash`) so the "Awaiting sign-in" tile disappears from
 * the UI.
 *
 * Ordering: chain first, then Supabase. If the chain call fails the row
 * stays around so admin can retry. If Supabase fails the chain hash is
 * already gone (the invite is dead from the user's POV) but the tile
 * lingers — the caller surfaces the error and admin can delete the row
 * manually via the fallback.
 */
export function useCancelSubaccountInvite(
  adminAddress: string | null,
  contractId: string | null,
): UseCancelSubaccountInviteResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(
    async (inviteTokenHashHex: string): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        const hashBytes = hexToBytes(inviteTokenHashHex);
        const args = [
          Address.fromString(adminAddress).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(hashBytes)),
        ];
        await invokeWrite(contractId, "cancel_subaccount_invite", args);
        const supabase = getSupabaseBrowserClient();
        const { error: delErr } = await supabase
          .from("family_subaccounts")
          .delete()
          .eq("invite_token_hash", inviteTokenHashHex);
        if (delErr) {
          throw new Error(
            `Invite cancelled on chain but the pending tile stayed: ${delErr.message}`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress, contractId],
  );

  return { cancel, pending, error };
}
