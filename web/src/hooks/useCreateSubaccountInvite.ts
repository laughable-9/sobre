"use client";

import { useCallback, useState } from "react";
import { xdr } from "@stellar/stellar-sdk";

import { getServer, invokeWrite } from "@/lib/contract";
import {
  base64UrlEncode,
  buildInviteUrl,
  bytesToHex,
  sha256,
} from "@/lib/encoding";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  INVITE_TTL_LEDGERS,
  type CreateInviteResult,
} from "@/hooks/useCreateInvite";

export interface UseCreateSubaccountInviteResult {
  createInvite: () => Promise<CreateInviteResult>;
  pending: boolean;
  error: string | null;
}

/**
 * Admin-only. Spins up a new sub-account invite:
 *
 *   1. Generate 32 random bytes (the plaintext token).
 *   2. Call `create_subaccount_invite(sha256(token), expires_at_ledger)` via
 *      the admin's passkey — one FaceID prompt.
 *   3. Insert a pending `family_subaccounts` row carrying the display name +
 *      emoji + sha256 hex of the same token. wallet_id stays NULL until the
 *      joiner redeems via /api/subaccount/join.
 *   4. Build the share URL containing the plaintext token + contract ID.
 *
 * If step 3 fails after step 2 succeeds, the on-chain invite is still live
 * for ~30 min — admin can retry. We surface a clear error noting that.
 */
export function useCreateSubaccountInvite(
  contractId: string | null,
  familyWalletId: string | null,
): UseCreateSubaccountInviteResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createInvite = useCallback(
    async (): Promise<CreateInviteResult> => {
      if (!contractId) throw new Error("No wallet selected.");
      if (!familyWalletId) throw new Error("Family wallet record missing.");
      setPending(true);
      setError(null);
      try {
        const token = crypto.getRandomValues(new Uint8Array(32));
        const tokenHashBytes = await sha256(token);
        const tokenHashHex = bytesToHex(tokenHashBytes);

        const latest = await getServer().getLatestLedger();
        const expiresAtLedger = latest.sequence + INVITE_TTL_LEDGERS;

        const args = [
          xdr.ScVal.scvBytes(Buffer.from(tokenHashBytes)),
          xdr.ScVal.scvU32(expiresAtLedger),
        ];
        await invokeWrite(contractId, "create_subaccount_invite", args);

        const supabase = getSupabaseBrowserClient();
        const { error: insertErr } = await supabase
          .from("family_subaccounts")
          .insert({
            family_wallet_id: familyWalletId,
            // Placeholder until the joiner claims — /api/subaccount/join
            // overwrites with their Google display name at claim time.
            display_name: "Awaiting sign-in",
            invite_token_hash: tokenHashHex,
          });
        if (insertErr) {
          throw new Error(
            `Invite minted on chain but couldn't save display data: ${insertErr.message}. The share link still works.`,
          );
        }

        return {
          url: buildInviteUrl(
            contractId,
            base64UrlEncode(token),
            "subaccount",
          ),
          expiresAtLedger,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [contractId, familyWalletId],
  );

  return { createInvite, pending, error };
}
