"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type SubaccountCashoutStatus =
  | "pending"
  | "spent"
  | "transferred"
  | "converted"
  | "processing"
  | "paid"
  | "failed";

export interface ActiveSubaccountCashoutRow {
  identifier: string;
  amount_usdc: number;
  amount_php: number | null;
  status: SubaccountCashoutStatus;
  failure_reason: string | null;
  beneficiary_bank_code: string;
  beneficiary_account_name: string;
  beneficiary_account_number: string;
  created_at: string;
}

export interface UseActiveSubaccountCashoutsResult {
  active: ActiveSubaccountCashoutRow[];
  refresh: () => Promise<void>;
}

/**
 * Sub-side mirror of useActiveCashouts. Polls /api/pdax/subaccount/cashouts/active
 * on mount + every 5s, and refetches on any pdax_withdrawals row change for
 * this wallet via Realtime. Used by SubAccountView to surface a PENDING
 * strip for in-flight cashouts with a tap-to-resume affordance.
 *
 * walletDbId is the sub-account holder's wallets.id — needed because the
 * Realtime postgres_changes filter on a foreign-key column requires the
 * subscriber to specify the exact value the row matches.
 */
export function useActiveSubaccountCashouts(
  walletDbId: string | null,
): UseActiveSubaccountCashoutsResult {
  const [active, setActive] = useState<ActiveSubaccountCashoutRow[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pdax/subaccount/cashouts/active");
      if (!res.ok) return;
      const json = (await res.json()) as {
        active: ActiveSubaccountCashoutRow[];
      };
      setActive(json.active ?? []);
    } catch {
      // best-effort; next poll re-tries
    }
  }, []);

  useEffect(() => {
    // Polling driver. Intentional external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // Heartbeat at the family-side cadence — Realtime carries the
    // real-time updates; this just catches a missed event or a
    // subscription that hasn't connected yet.
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!walletDbId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`sub-cashouts:${walletDbId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "pdax_withdrawals",
          filter: `member_id=eq.${walletDbId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [walletDbId, refresh]);

  return useMemo(() => ({ active, refresh }), [active, refresh]);
}
