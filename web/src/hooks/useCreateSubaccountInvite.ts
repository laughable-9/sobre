"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { getServer, invokeWrite } from "@/lib/contract";
import {
  base64UrlEncode,
  buildInviteUrl,
  bytesToHex,
  sha256,
} from "@/lib/encoding";
import { isRecord, makePendingSlot } from "@/lib/pendingMutation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  INVITE_TTL_LEDGERS,
  type CreateInviteResult,
} from "@/hooks/useCreateInvite";

/** Checkpoint after the on-chain `create_subaccount_invite` lands but
 *  before the family_subaccounts row insert. Without this, a Supabase
 *  failure leaves the on-chain invite live but with no admin-side revoke
 *  tile — the retry would mint a second on-chain invite AND leave the
 *  first one dangling. Resume re-runs only the row insert. */
interface SubaccountInviteProgress {
  tokenB64: string;
  tokenHashHex: string;
  expiresAtLedger: number;
}

const subaccountInviteSlot = makePendingSlot<SubaccountInviteProgress>(
  "sobre.pendingSubaccountInvite",
  (v): v is SubaccountInviteProgress =>
    isRecord(v) &&
    typeof v.tokenB64 === "string" &&
    typeof v.tokenHashHex === "string" &&
    typeof v.expiresAtLedger === "number",
);

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
  adminAddress: string | null,
  contractId: string | null,
  familyWalletId: string | null,
): UseCreateSubaccountInviteResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createInvite = useCallback(
    async (): Promise<CreateInviteResult> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (!familyWalletId) throw new Error("Family wallet record missing.");
      setPending(true);
      setError(null);
      try {
        const slotOwner = `${adminAddress}:${contractId}:${familyWalletId}`;
        const resumed = subaccountInviteSlot.read(slotOwner);

        let tokenB64: string;
        let tokenHashHex: string;
        let expiresAtLedger: number;

        if (resumed) {
          tokenB64 = resumed.tokenB64;
          tokenHashHex = resumed.tokenHashHex;
          expiresAtLedger = resumed.expiresAtLedger;
        } else {
          const token = crypto.getRandomValues(new Uint8Array(32));
          const tokenHashBytes = await sha256(token);
          tokenHashHex = bytesToHex(tokenHashBytes);
          tokenB64 = base64UrlEncode(token);

          const latest = await getServer().getLatestLedger();
          expiresAtLedger = latest.sequence + INVITE_TTL_LEDGERS;

          const args = [
            Address.fromString(adminAddress).toScVal(),
            xdr.ScVal.scvBytes(Buffer.from(tokenHashBytes)),
            xdr.ScVal.scvU32(expiresAtLedger),
          ];
          await invokeWrite(contractId, "create_subaccount_invite", args);

          // Checkpoint immediately — a Supabase failure below would
          // otherwise leave the on-chain invite live with no admin
          // revoke tile, and retry would mint a second invite.
          subaccountInviteSlot.write(slotOwner, {
            tokenB64,
            tokenHashHex,
            expiresAtLedger,
          });
        }

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
        subaccountInviteSlot.clear(slotOwner);

        return {
          url: buildInviteUrl(contractId, tokenB64, "subaccount"),
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
    [adminAddress, contractId, familyWalletId],
  );

  return { createInvite, pending, error };
}
