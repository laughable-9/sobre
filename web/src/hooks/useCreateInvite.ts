"use client";

import { useCallback, useState } from "react";
import { Address, xdr } from "@stellar/stellar-sdk";

import { getServer, invokeWrite } from "@/lib/contract";
import {
  base64UrlEncode,
  buildInviteUrl,
  byteaLiteral,
  sha256,
} from "@/lib/encoding";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Stellar ledgers close every ~5s on testnet. 360 ledgers ≈ 30 min — the
 *  expiry window the admin's invite link is valid for. Keep short so a
 *  shared/leaked URL has a small window of abuse. The matching minutes
 *  constant is derived from this so UI copy stays in sync with the on-chain
 *  enforcement. */
export const INVITE_TTL_LEDGERS = 360;
const LEDGERS_PER_MINUTE = 12; // 12 * 5s = 60s
export const INVITE_TTL_MINUTES = INVITE_TTL_LEDGERS / LEDGERS_PER_MINUTE;

export interface CreateInviteResult {
  /** Full URL to share with the invitee. */
  url: string;
  /** Ledger sequence at which the on-chain invite expires. */
  expiresAtLedger: number;
}

/** Discriminated union so 'admin' invites can't be minted without the
 *  family_wallets.id + creator wallets.id the hint row needs. Member
 *  invites carry no options because they don't touch Supabase. */
export type CreateInviteOptions =
  | { intendedRole?: "member" }
  | {
      intendedRole: "admin";
      familyWalletId: string;
      /** wallets.id of the admin minting the invite. Passed in from the
       *  caller (usePasskeyWallet.wallet.id) so the hook doesn't need
       *  a second Supabase round-trip to look it up. */
      createdByWalletId: string;
    };

export interface UseCreateInviteResult {
  createInvite: (opts?: CreateInviteOptions) => Promise<CreateInviteResult>;
  pending: boolean;
  error: string | null;
}

/**
 * Admin-only. Mints a single-use invite:
 *
 *   1. Generate 32 random bytes (the plaintext token).
 *   2. Compute sha256(plaintext) for on-chain storage.
 *   3. Call `create_invite(token_hash, expires_at_ledger)` via the admin's
 *      passkey — single FaceID prompt.
 *   4. Build a shareable URL containing the plaintext token + the family
 *      contract ID. The recipient redeems by calling `join_wallet` with the
 *      plaintext; the contract verifies `sha256(plaintext) == stored hash`.
 *
 * The plaintext only ever travels in the URL; chain storage carries the
 * hash so a passive Soroban indexer can't intercept and redeem.
 */
export function useCreateInvite(
  adminAddress: string | null,
  contractId: string | null,
): UseCreateInviteResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createInvite = useCallback(
    async (opts?: CreateInviteOptions): Promise<CreateInviteResult> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      const intendedRole = opts?.intendedRole ?? "member";
      setPending(true);
      setError(null);
      try {
        const token = crypto.getRandomValues(new Uint8Array(32));
        const tokenHash = await sha256(token);

        const latest = await getServer().getLatestLedger();
        const expiresAtLedger = latest.sequence + INVITE_TTL_LEDGERS;

        const args = [
          Address.fromString(adminAddress).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(tokenHash)),
          xdr.ScVal.scvU32(expiresAtLedger),
        ];
        await invokeWrite(contractId, "create_invite", args);

        // Admin-role hint. Insert AFTER the on-chain mint so we never
        // leave a Supabase hint pointing at a hash that never made it
        // to chain. RLS enforces admin-only insert; the caller supplies
        // family_wallets.id + wallets.id so we skip a round-trip.
        if (opts?.intendedRole === "admin") {
          const supabase = getSupabaseBrowserClient();
          const { error: insertErr } = await supabase
            .from("admin_invite_hints")
            .insert({
              token_hash: byteaLiteral(tokenHash),
              family_wallet_id: opts.familyWalletId,
              created_by: opts.createdByWalletId,
            });
          if (insertErr) throw new Error(insertErr.message);
        }

        return {
          url: buildInviteUrl(
            contractId,
            base64UrlEncode(token),
            intendedRole,
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
    [adminAddress, contractId],
  );

  return { createInvite, pending, error };
}
