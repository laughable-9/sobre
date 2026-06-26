"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WithdrawStatus } from "@/hooks/usePdaxWithdraw";
import {
  clearCashoutRecovery,
  readCashoutRecovery,
} from "@/lib/cashoutRecovery";

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
  /** Recently-failed cashouts for the activity feed to render. Without
   *  this they vanish silently after status=failed and the user has no
   *  trail of "what happened to my cashout". */
  recentlyFailed: ActiveCashoutRow[];
  refresh: () => Promise<void>;
}

const HEARTBEAT_MS = 8000;

/** Fires for cashouts that just settled (paid) or failed. The dashboard
 *  uses it to flash "₱X landed in your bank" when a cashout the user
 *  closed the modal on finally completes in the background. */
export interface ActiveCashoutsCallbacks {
  onPaid?: (row: ActiveCashoutRow) => void;
  onFailed?: (row: ActiveCashoutRow) => void;
}

export function useActiveCashouts(
  contractId: string | null,
  callbacks?: ActiveCashoutsCallbacks,
): UseActiveCashoutsResult {
  const [cashouts, setCashouts] = useState<ActiveCashoutRow[]>([]);
  const [recentlyFailed, setRecentlyFailed] = useState<ActiveCashoutRow[]>([]);
  // Snapshot the previous active list so we can detect rows that
  // dropped off into a terminal state since the last heartbeat. The
  // /active endpoint excludes paid/failed, so a row vanishing from
  // there means "transitioned to terminal" — we look up which terminal
  // state via /row to fire the right callback.
  const lastActiveRef = useRef<Map<string, ActiveCashoutRow>>(new Map());
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const refresh = useCallback(async () => {
    if (!contractId) {
      setCashouts([]);
      setRecentlyFailed([]);
      lastActiveRef.current = new Map();
      return;
    }
    try {
      const res = await fetch(
        `/api/pdax/withdrawals/active?contract_id=${encodeURIComponent(contractId)}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        cashouts: ActiveCashoutRow[];
        recentlyFailed?: ActiveCashoutRow[];
      };
      const next = json.cashouts ?? [];
      setRecentlyFailed(json.recentlyFailed ?? []);
      const nextIds = new Set(next.map((c) => c.identifier));

      // Detect drop-offs: rows that were active last tick but aren't
      // now. Look up their terminal state and notify.
      const droppedOff: ActiveCashoutRow[] = [];
      for (const [id, row] of lastActiveRef.current) {
        if (!nextIds.has(id)) droppedOff.push(row);
      }
      lastActiveRef.current = new Map(next.map((c) => [c.identifier, c]));
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

      // Fan-out terminal-state notifications. /row returns the current
      // status so we know which callback to fire. Also tear down the
      // cashout-recovery localStorage entry whenever the row tied to it
      // reaches a terminal state — the spend's "lost" state isn't
      // recoverable anymore once paid or failed has been decided.
      for (const row of droppedOff) {
        void fetch(`/api/pdax/withdrawals/${row.identifier}/row`)
          .then(async (r) => {
            if (!r.ok) return;
            const body = (await r.json()) as {
              cashout: ActiveCashoutRow;
            };
            const final = body.cashout;
            const snap = readCashoutRecovery();
            if (snap && snap.identifier === final.identifier) {
              clearCashoutRecovery();
            }
            if (final.status === "paid") callbacksRef.current?.onPaid?.(final);
            else if (final.status === "failed")
              callbacksRef.current?.onFailed?.(final);
          })
          .catch(() => null);
      }
    } catch {
      // best effort
    }
  }, [contractId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { cashouts, recentlyFailed, refresh };
}
