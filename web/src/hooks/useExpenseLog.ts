"use client";

import { useCallback, useEffect, useState } from "react";

export interface ExpenseLog {
  id: string;
  note: string;
  created_at: string;
  wallet_id: string;
}

export interface UseExpenseLogResult {
  logs: ExpenseLog[];
  loading: boolean;
  error: string | null;
  /** Save a note off-chain immediately. Returns the created row (with id) so
   *  the caller can offer an undo that deletes it. */
  logExpense: (note: string) => Promise<ExpenseLog>;
  /** Undo: delete a note the caller authored. */
  deleteExpense: (id: string) => Promise<void>;
  refresh: () => void;
}

/**
 * Off-chain expense notes for a family wallet. Backed by /api/expense-logs
 * (service-role + membership-gated). No blockchain, no signing — saving is a
 * single INSERT so it lands instantly; undo is a DELETE within the client's
 * grace window.
 *
 * `familyWalletId` is null until the dashboard resolves it; the hook no-ops
 * (empty list, no fetch) until then.
 */
export function useExpenseLog(
  familyWalletId: string | null,
): UseExpenseLogResult {
  const [logs, setLogs] = useState<ExpenseLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!familyWalletId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/expense-logs?family_wallet_id=${familyWalletId}`)
      .then(async (res) => {
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ logs: ExpenseLog[] }>;
      })
      .then((d) => setLogs(d.logs))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [familyWalletId]);

  useEffect(() => {
    // Fetch-on-mount external-sync effect (same shape as useActiveDeposits).
    // The rule flags refresh()'s synchronous setLoading; it's intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const logExpense = useCallback(
    async (note: string): Promise<ExpenseLog> => {
      if (!familyWalletId) throw new Error("No family wallet.");
      const res = await fetch("/api/expense-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_wallet_id: familyWalletId, note }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { log } = (await res.json()) as { log: ExpenseLog };
      // Optimistically prepend so it appears instantly.
      setLogs((prev) => [log, ...prev]);
      return log;
    },
    [familyWalletId],
  );

  const deleteExpense = useCallback(
    async (id: string): Promise<void> => {
      if (!familyWalletId) return;
      // Optimistically drop it from the list right away (undo should feel
      // instant); reconcile on failure by refreshing.
      setLogs((prev) => prev.filter((l) => l.id !== id));
      const res = await fetch(
        `/api/expense-logs?id=${id}&family_wallet_id=${familyWalletId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        refresh();
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
    },
    [familyWalletId, refresh],
  );

  return { logs, loading, error, logExpense, deleteExpense, refresh };
}
