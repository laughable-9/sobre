"use client";

import { useCallback, useEffect, useState } from "react";

import type { WithdrawStatus } from "@/hooks/usePdaxWithdraw";

/**
 * Lists the signed-in member's non-terminal cashout rows for a family
 * wallet. Two jobs:
 *
 *   1. Surface them in the activity feed as a PENDING bucket so the user
 *      can see where their money is even after a refresh / wifi blip /
 *      accidental tab close.
 *
 *   2. Auto-drive each non-terminal row by hitting its poll-status route
 *      from the dashboard — the modal would normally do this, but if the
 *      modal isn't open the state machine stalls. Background polling
 *      from here makes sure spent → transferred → converted → paid
 *      progresses to completion even if the user never reopens the
 *      modal. Server-side state machine is idempotent so the modal
 *      polling running in parallel is harmless.
 *
 * Heartbeat is 8s. Fast enough that paid emails arrive within a few
 * seconds of the UI showing "Done"; slow enough that we're not hammering
 * Supabase + PDAX OAuth for every dashboard mount.
 */

export interface ActiveCashoutRow {
  identifier: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  amount_usdc: number;
  amount_php: number | null;
  status: WithdrawStatus;
  failure_reason: string | null;
  beneficiary_bank_code: string;
  beneficiary_account_name: string;
  beneficiary_account_number: string;
  created_at: string;
}

export interface UseActiveCashoutsResult {
  cashouts: ActiveCashoutRow[];
  refresh: () => Promise<void>;
}

const HEARTBEAT_MS = 8000;

export function useActiveCashouts(
  contractId: string | null,
): UseActiveCashoutsResult {
  const [cashouts, setCashouts] = useState<ActiveCashoutRow[]>([]);

  const refresh = useCallback(async () => {
    if (!contractId) {
      setCashouts([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/pdax/withdrawals/active?contract_id=${encodeURIComponent(contractId)}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as { cashouts: ActiveCashoutRow[] };
      const next = json.cashouts ?? [];
      setCashouts(next);

      // Background drive: nudge every non-terminal row forward. Parallel
      // best-effort — failures just retry on the next heartbeat. The
      // modal's polling does the same job when open; the server treats
      // both as idempotent state-machine ticks.
      await Promise.all(
        next.map((c) =>
          fetch(`/api/pdax/withdrawals/${c.identifier}/poll-status`).catch(
            () => null,
          ),
        ),
      );
    } catch {
      // best effort
    }
  }, [contractId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { cashouts, refresh };
}
