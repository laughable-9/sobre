"use client";

import { useCallback, useEffect, useState } from "react";

import type { DepositStatus } from "@/hooks/usePdaxDeposit";

/**
 * Lists the signed-in member's open PDAX deposit rows for a family wallet
 * so the dashboard can surface a "Pending: ₱X — Resume" item in the
 * activity feed. Most useful when the user closed the modal at
 * `credited` (XLM is in their smart wallet, envelopes still empty) — the
 * resume button re-opens the modal straight at the ConfirmStep so they
 * can finish the split.
 *
 * Fetches on mount and exposes `refresh()` for the dashboard to call
 * after a deposit modal closes (or after a split / cancel toast fires).
 * A heartbeat poll keeps it warm in case the user resumed in another
 * tab.
 */

export interface ActiveDepositRow {
  identifier: string;
  amount_php: number;
  amount_usdc: number | null;
  payment_checkout_url: string | null;
  status: DepositStatus;
  failure_reason: string | null;
  created_at: string;
}

export interface UseActiveDepositsResult {
  deposits: ActiveDepositRow[];
  /** Recently-failed deposits (within ~7 days) for the activity feed to
   *  render as terminal warning entries. The active list excludes
   *  failed status, so without this they'd vanish from view. */
  recentlyFailed: ActiveDepositRow[];
  refresh: () => Promise<void>;
}

export function useActiveDeposits(
  contractId: string | null,
): UseActiveDepositsResult {
  const [deposits, setDeposits] = useState<ActiveDepositRow[]>([]);
  const [recentlyFailed, setRecentlyFailed] = useState<ActiveDepositRow[]>([]);

  const refresh = useCallback(async () => {
    if (!contractId) {
      setDeposits([]);
      setRecentlyFailed([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/pdax/deposits/active?contract_id=${encodeURIComponent(contractId)}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        deposits: ActiveDepositRow[];
        recentlyFailed?: ActiveDepositRow[];
      };
      setDeposits(json.deposits ?? []);
      setRecentlyFailed(json.recentlyFailed ?? []);
    } catch {
      // best effort; the next refresh / poll will retry
    }
  }, [contractId]);

  useEffect(() => {
    void refresh();
    // 30s heartbeat — too slow to be a real driver, fast enough that
    // resumes from another tab show up within a screen-glance.
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { deposits, recentlyFailed, refresh };
}
