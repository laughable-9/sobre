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
  /** Set when the row is past the /active stale TTL but a matching
   *  on-chain Spend event exists — i.e. the spend leg landed but the
   *  SAC forward didn't, leaving an orphan that needs the user to
   *  finish via the recovery prompt. Activity feed uses this to swap
   *  the PendingCashoutRow copy from "Preparing" (misleading) to
   *  "Needs your confirmation". */
  recoverable?: boolean;
}

export interface UseActiveCashoutsResult {
  cashouts: ActiveCashoutRow[];
  /** Recently-failed cashouts for the activity feed to render. Without
   *  this they vanish silently after status=failed and the user has no
   *  trail of "what happened to my cashout". */
  recentlyFailed: ActiveCashoutRow[];
  /** Recently-completed (paid) cashouts. Activity feed correlates these
   *  with the on-chain Spend event by envelope+amount+time so the
   *  successful cashout renders the destination bank inline. */
  recentlyCompleted: ActiveCashoutRow[];
  refresh: () => Promise<void>;
}

const HEARTBEAT_MS = 8000;
/** /recoverable is a Soroban event scan (~1-2s). We only need it for
 *  orphan-detection — an already-discovered orphan keeps showing via
 *  the cache below. Every 4th tick (~32s) is more than fresh enough
 *  for "user finished cashout, modal failed, now they want to find
 *  it" — and cuts the wasted RPC traffic 4× on idle dashboards. */
const RECOVERABLE_EVERY_N_TICKS = 4;

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
  const [recentlyCompleted, setRecentlyCompleted] = useState<
    ActiveCashoutRow[]
  >([]);
  // Snapshot the previous active list so we can detect rows that
  // dropped off into a terminal state since the last heartbeat. The
  // /active endpoint excludes paid/failed, so a row vanishing from
  // there means "transitioned to terminal" — we look up which terminal
  // state via /row to fire the right callback.
  const lastActiveRef = useRef<Map<string, ActiveCashoutRow>>(new Map());
  // Cached last-known recoverable rows. /recoverable is throttled to
  // run every Nth tick (see RECOVERABLE_EVERY_N_TICKS) because a full
  // Soroban event scan costs ~1-2s — too expensive to hammer at 8s
  // cadence on idle dashboards. The cache lets us keep surfacing
  // already-discovered orphans in PENDING between scans.
  const lastRecoverableRef = useRef<ActiveCashoutRow[]>([]);
  const recoverableTickRef = useRef(0);
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const refresh = useCallback(async () => {
    if (!contractId) {
      setCashouts([]);
      setRecentlyFailed([]);
      setRecentlyCompleted([]);
      lastActiveRef.current = new Map();
      lastRecoverableRef.current = [];
      return;
    }
    try {
      // /active runs every tick. /recoverable scans on-chain Spend
      // events (expensive) — throttle to every Nth tick and cache the
      // result so orphans stay visible in PENDING between scans.
      const fetchRecoverable = recoverableTickRef.current === 0;
      recoverableTickRef.current =
        (recoverableTickRef.current + 1) % RECOVERABLE_EVERY_N_TICKS;
      const [activeRes, recoverableRes] = await Promise.all([
        fetch(
          `/api/pdax/withdrawals/active?contract_id=${encodeURIComponent(contractId)}`,
        ),
        fetchRecoverable
          ? fetch(
              `/api/pdax/withdrawals/recoverable?contract_id=${encodeURIComponent(contractId)}`,
            ).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!activeRes.ok) return;
      const json = (await activeRes.json()) as {
        cashouts: ActiveCashoutRow[];
        recentlyFailed?: ActiveCashoutRow[];
        recentlyCompleted?: ActiveCashoutRow[];
      };
      const active = json.cashouts ?? [];
      setRecentlyFailed(json.recentlyFailed ?? []);
      setRecentlyCompleted(json.recentlyCompleted ?? []);

      // Refresh the recoverable cache only when we actually fetched.
      // Between scans, lastRecoverableRef keeps the previously-found
      // orphans visible — they don't disappear just because we
      // skipped a tick.
      if (fetchRecoverable && recoverableRes?.ok) {
        const rec = (await recoverableRes.json()) as {
          recoverable?: Array<{
            identifier: string;
            envelope: "Groceries" | "Tuition" | "Savings";
            amountToken: number;
            amountPhp: number;
            beneficiary_bank_code: string;
            beneficiary_account_name: string;
            beneficiary_account_number: string;
            created_at: string;
          }>;
        };
        lastRecoverableRef.current = (rec.recoverable ?? []).map((r) => ({
          identifier: r.identifier,
          envelope: r.envelope,
          amount_usdc: r.amountToken,
          amount_php: r.amountPhp,
          status: "pending" as const,
          failure_reason: null,
          beneficiary_bank_code: r.beneficiary_bank_code,
          beneficiary_account_name: r.beneficiary_account_name,
          beneficiary_account_number: r.beneficiary_account_number,
          created_at: r.created_at,
          recoverable: true,
        }));
      }

      // Merge: /active rows + cached recoverable rows /active didn't
      // surface (deduped by identifier).
      const activeIds = new Set(active.map((c) => c.identifier));
      const recoverable = lastRecoverableRef.current.filter(
        (r) => !activeIds.has(r.identifier),
      );
      const next = [...active, ...recoverable];
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
      // both as idempotent state-machine ticks. Skip recoverable rows
      // because their server-side state is "pending" by design — they
      // need the user to confirm via the recovery prompt, not a tick.
      await Promise.all(
        next
          .filter((c) => !c.recoverable)
          .map((c) =>
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
      // Skip recoverable rows that transiently dropped off (e.g. RPC
      // blip returned an empty page) — they aren't transitioning to a
      // terminal state, so a /row lookup is just wasted bytes.
      for (const row of droppedOff) {
        if (row.recoverable) continue;
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
    // Polling driver — refresh() feeds setState from a fetch. Heartbeat
    // catches missed realtime updates; intentional external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const t = setInterval(() => void refresh(), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { cashouts, recentlyFailed, recentlyCompleted, refresh };
}
