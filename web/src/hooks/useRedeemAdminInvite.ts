"use client";

import { useCallback } from "react";

import { byteaLiteral, sha256 } from "@/lib/encoding";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";

export type RedeemAdminOutcome =
  | { outcome: "admin_granted"; already_admin: boolean }
  | { outcome: "family_full"; admin_cap: number; current_admins: number }
  | { outcome: "not_a_chain_member" }
  | { outcome: "already_redeemed" }
  | { outcome: "cancelled" }
  | { outcome: "invalid_invite" }
  | { outcome: "not_authenticated" };

/**
 * Client-side wrapper around the `redeem_admin_invite` SECURITY DEFINER
 * RPC. Hashes the plaintext token on the client so the RPC receives the
 * same bytea the invite mint stored. Returns the raw outcome so the
 * caller can flash a role-specific toast + route back to the dashboard.
 */
export function useRedeemAdminInvite() {
  const call = useCallback(
    async (plaintextToken: Uint8Array): Promise<RedeemAdminOutcome> => {
      const hash = await sha256(plaintextToken);
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("redeem_admin_invite", {
        p_token_hash: byteaLiteral(hash),
      });
      if (error) throw error;
      return data as RedeemAdminOutcome;
    },
    [],
  );
  const { run: redeem, pending, error } = useSupabaseMutation(call);
  return { redeem, pending, error };
}
