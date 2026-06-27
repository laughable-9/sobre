"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { invokeWrite } from "@/lib/contract";
import { base64UrlEncode } from "@/lib/encoding";
import { rememberJoinedSobre } from "@/lib/joinedSobres";

export interface UseJoinAsSubaccountResult {
  /** `inviteToken` is the 32-byte plaintext from the URL, base64url-decoded
   *  by the caller. */
  joinAsSubaccount: (inviteToken: Uint8Array) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Joiner side of the sub-account invite flow. Two phases:
 *
 *   1. On-chain: `join_as_subaccount(caller, token)` — the contract checks
 *      sha256(token) was registered via `create_subaccount_invite` and the
 *      caller isn't already a member or a sub-account. Single passkey prompt.
 *   2. Server-side claim via POST /api/subaccount/join — sets wallet_id on
 *      the pending family_subaccounts row after verifying the on-chain hit.
 *
 * Phase 2 is on the server (not RLS) because the only client-safe gate
 * would let an unscoped UPDATE squat every pending row across the app.
 */
export function useJoinAsSubaccount(
  userAddress: string | null,
  contractId: string | null,
): UseJoinAsSubaccountResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinAsSubaccount = useCallback(
    async (inviteToken: Uint8Array): Promise<string> => {
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
        const { hash } = await invokeWrite(
          contractId,
          "join_as_subaccount",
          args,
        );
        rememberJoinedSobre(userAddress, contractId);

        const res = await fetch("/api/subaccount/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract_id: contractId,
            invite_token: base64UrlEncode(inviteToken),
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            `Joined on chain but couldn't link your display profile: ${
              j.error ?? `${res.status}`
            }`,
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

  return { joinAsSubaccount, pending, error };
}
