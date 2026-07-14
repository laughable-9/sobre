"use client";

import { useState } from "react";
import {
  CheckIcon,
} from "@phosphor-icons/react";

import { Sheet } from "@/components/sobre/Sheet";
import { useRenameWallet } from "@/hooks/useRenameWallet";

/** Hard cap on the wallet name — same 40-char limit the create forms use.
 *  Long names also ellipsize in the title display, but the guard here stops
 *  them at the source. */
const MAX_NAME_LEN = 40;

/**
 * Rename dialog for the family wallet — opened from the pencil on the
 * balance hero. The name only changes when the admin confirms ("Save name"),
 * which finalizes via the same useRenameWallet path the old TopBar pill used.
 */
export function RenameWalletModal({
  currentName,
  adminAddress,
  contractId,
  onClose,
  onRenamed,
}: {
  currentName: string;
  adminAddress: string | null;
  contractId: string;
  onClose: () => void;
  /** Fired after the rename lands (dashboard refreshes + toasts). */
  onRenamed?: () => void;
}) {
  const [draft, setDraft] = useState(currentName);
  const { renameWallet, pending } = useRenameWallet(adminAddress, contractId);
  const [error, setError] = useState<string | null>(null);

  const next = draft.trim();
  const unchanged = next === currentName.trim();
  const tooLong = next.length > MAX_NAME_LEN;
  const valid = next.length > 0 && !unchanged && !tooLong;

  const save = async () => {
    if (!valid || pending) return;
    setError(null);
    try {
      await renameWallet(next);
      onRenamed?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet onClose={onClose} ariaLabel="Rename Sobre">
        <h2>Rename this Sobre</h2>
        <p className="sub">
          The new name shows for every member the moment it saves.
        </p>

        <div className="sobre-input-group">
          <label htmlFor="rename-wallet">Sobre name</label>
          <input
            id="rename-wallet"
            className="sobre-input"
            type="text"
            autoFocus
            value={draft}
            maxLength={MAX_NAME_LEN}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_NAME_LEN))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") onClose();
            }}
          />
          <div
            className="mt-1.5 flex justify-end text-[11px] tabular"
            style={{
              color:
                draft.length >= MAX_NAME_LEN
                  ? "var(--sobre-danger)"
                  : "var(--sobre-text-3)",
            }}
          >
            {draft.length}/{MAX_NAME_LEN}
          </div>
        </div>

        {error ? (
          <p
            className="mt-2 break-all text-xs"
            style={{ color: "var(--sobre-danger)" }}
          >
            {error}
          </p>
        ) : null}

        <div className="sobre-modal-actions">
          <button
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="sobre-btn sobre-btn-primary"
            onClick={() => void save()}
            disabled={!valid || pending}
            style={{ opacity: !valid || pending ? 0.6 : 1 }}
          >
            <CheckIcon weight="bold" size={14} />
            {pending ? "Saving…" : "Save name"}
          </button>
        </div>
    </Sheet>
  );
}
