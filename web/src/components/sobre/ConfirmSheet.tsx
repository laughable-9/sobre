"use client";

import { Sheet } from "@/components/sobre/Sheet";

/**
 * Small in-app confirmation modal. Replaces `window.confirm` for
 * anything user-facing so the OS-chrome dialog doesn't clash with the
 * app's own look, doesn't get flagged by browsers ("this site says…"),
 * and stays consistent across mobile Safari + desktop Chrome.
 *
 * Not for anything money-moving with real irreversibility — those
 * flows own their own step machine + inputs. Use this for
 * cheap yes/no gates like "cancel this invite" or "log out".
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmTone = "default",
  onConfirm,
  onCancel,
  pending = false,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` red-tints the confirm button. Reserve for destructive
   *  actions (cancel invite, remove member, close wallet). */
  confirmTone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  /** When true the confirm button shows a spinner label and is disabled
   *  — the parent is still running the confirmed action. */
  pending?: boolean;
}) {
  if (!open) return null;
  return (
    <Sheet
      onClose={onCancel}
      canClose={!pending}
      draggable={false}
      ariaLabel={title}
      role="alertdialog"
      className="sobre-confirm-sheet"
    >
      <h2>{title}</h2>
      <p className="sub">{body}</p>

      <div
        className="sobre-modal-actions"
        style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
      >
        <button
          type="button"
          className="sobre-btn sobre-btn-soft"
          onClick={onCancel}
          disabled={pending}
          style={{ padding: "10px 18px" }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={
            confirmTone === "danger"
              ? "sobre-btn sobre-btn-danger"
              : "sobre-btn sobre-btn-primary"
          }
          onClick={onConfirm}
          disabled={pending}
          style={{ padding: "10px 18px" }}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
