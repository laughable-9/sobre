"use client";

import { useCallback } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";

/**
 * Outcomes from `update_admin_cap`. Every failure mode is surfaced as
 * data (no plain `error`), so the caller can distinguish invariant
 * violations (`below_admin_count`) from race losses (`stale`) from
 * authorization failures (`not_admin`) and render each in copy the user
 * actually understands.
 */
export type UpdateAdminCapOutcome =
  | { outcome: "updated"; admin_cap: number; cancelled_hints: number }
  | { outcome: "no_change" }
  | { outcome: "stale"; current_cap: number }
  | { outcome: "below_admin_count"; current_admins: number }
  | { outcome: "out_of_range"; min: number; max: number }
  | { outcome: "not_admin" }
  | { outcome: "not_found" }
  | { outcome: "not_authenticated" };

/**
 * Client wrapper around the update_admin_cap SECURITY DEFINER RPC. The
 * RPC takes a row-lock, enforces cap >= current admin count, and rejects
 * an update whose `expectedCap` doesn't match the row (optimistic
 * locking so two admins editing simultaneously don't silently overwrite
 * each other). Also sweeps any admin invite hints that the new cap would
 * orphan — reported back as `cancelled_hints` so the UI can tell the
 * user how many outstanding invites just died.
 */
export function useUpdateAdminCap() {
  const call = useCallback(
    async (
      familyWalletId: string,
      expectedCap: number,
      newCap: number,
    ): Promise<UpdateAdminCapOutcome> => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("update_admin_cap", {
        p_family_wallet_id: familyWalletId,
        p_expected_cap: expectedCap,
        p_new_cap: newCap,
      });
      if (error) throw error;
      return data as UpdateAdminCapOutcome;
    },
    [],
  );
  const { run: update, pending, error } = useSupabaseMutation(call);
  return { update, pending, error };
}
