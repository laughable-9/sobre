"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUUpLeftIcon,
  CheckIcon,
  PlusIcon,
} from "@phosphor-icons/react";

import { useExpenseLog, type ExpenseLog } from "@/hooks/useExpenseLog";

/** Undo window in ms. The row is already saved; this is how long the user has
 *  to pull it back before the toast dismisses. */
const UNDO_MS = 10_000;

/**
 * Expense logging: a single "What did you spend on?" field that saves the note
 * off-chain immediately, then shows a 10-second Undo. No amount, no signing —
 * these are record-only notes (see /api/expense-logs).
 */
export function ExpenseQuickAdd({
  familyWalletId,
}: {
  familyWalletId: string | null;
}) {
  const { logExpense, deleteExpense } = useExpenseLog(familyWalletId);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The just-saved log we're offering to undo, plus a countdown.
  const [undoable, setUndoable] = useState<ExpenseLog | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timers = useRef<{ dismiss?: number; tick?: number }>({});

  const clearTimers = () => {
    if (timers.current.dismiss) window.clearTimeout(timers.current.dismiss);
    if (timers.current.tick) window.clearInterval(timers.current.tick);
    timers.current = {};
  };
  useEffect(() => clearTimers, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length === 0 || saving || !familyWalletId) return;
    setSaving(true);
    setError(null);
    try {
      const log = await logExpense(trimmed);
      setNote("");
      // Start the undo window.
      clearTimers();
      setUndoable(log);
      setSecondsLeft(Math.round(UNDO_MS / 1000));
      timers.current.tick = window.setInterval(
        () => setSecondsLeft((s) => Math.max(0, s - 1)),
        1000,
      );
      timers.current.dismiss = window.setTimeout(() => {
        setUndoable(null);
        clearTimers();
      }, UNDO_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!undoable) return;
    const target = undoable;
    setUndoable(null);
    clearTimers();
    try {
      await deleteExpense(target.id);
    } catch {
      // deleteExpense refreshes on failure; surface a soft error.
      setError("Couldn't undo — it may already be saved.");
    }
  };

  return (
    <div className="mb-5">
      <form onSubmit={submit} className="flex items-stretch gap-2">
        <div className="sobre-input-wrap flex-1">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="What did you spend on?"
            maxLength={200}
            disabled={saving || !familyWalletId}
            className="sobre-input"
            style={{ padding: "12px 14px", fontSize: 15, width: "100%" }}
            aria-label="What did you spend on?"
          />
        </div>
        <button
          type="submit"
          disabled={saving || note.trim().length === 0 || !familyWalletId}
          className="sobre-btn sobre-btn-primary"
          style={{
            padding: "0 18px",
            opacity:
              saving || note.trim().length === 0 || !familyWalletId ? 0.5 : 1,
            cursor:
              saving || note.trim().length === 0 || !familyWalletId
                ? "not-allowed"
                : "pointer",
          }}
        >
          <PlusIcon weight="bold" size={16} />
          {saving ? "Saving…" : "Log"}
        </button>
      </form>

      {error ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--sobre-danger)" }}>
          {error}
        </p>
      ) : null}

      {undoable ? (
        <div
          className="mt-2 flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5"
          style={{
            background: "var(--accent-soft)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="flex min-w-0 items-center gap-2 text-[13px]"
            style={{ color: "var(--sobre-accent)" }}
          >
            <CheckIcon weight="bold" size={15} className="flex-shrink-0" />
            <span className="truncate">
              Saved “{undoable.note}”
            </span>
          </div>
          <button
            type="button"
            onClick={undo}
            className="tabular flex flex-shrink-0 items-center gap-1.5 text-[13px] font-semibold"
            style={{ color: "var(--text-1)" }}
          >
            <ArrowUUpLeftIcon weight="bold" size={14} />
            Undo ({secondsLeft})
          </button>
        </div>
      ) : null}
    </div>
  );
}
