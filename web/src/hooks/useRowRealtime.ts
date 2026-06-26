"use client";

import { useEffect } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Subscribe to a single Supabase row's UPDATE events. Used by the PDAX
 * deposit + withdraw hooks to mirror their `pdax_deposits` /
 * `pdax_withdrawals` rows into local state as the server-side pipeline
 * marches through its state machine.
 *
 * `onUpdate` should be stable (a `useCallback` reference) or wrapped in a
 * ref by the caller — the channel resubscribes whenever it changes. For
 * the typical "setRow(payload.new)" callback the closure-stable form
 * `setRow` already gives us is fine.
 */
export function useRowRealtime<T>(
  table: string,
  identifier: string | null,
  onUpdate: (row: T) => void,
): void {
  useEffect(() => {
    if (!identifier) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`${table}:${identifier}`)
      .on(
        "postgres_changes" as never,
        {
          event: "UPDATE",
          schema: "public",
          table,
          filter: `identifier=eq.${identifier}`,
        },
        (payload: { new: T }) => {
          onUpdate(payload.new);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, identifier, onUpdate]);
}
