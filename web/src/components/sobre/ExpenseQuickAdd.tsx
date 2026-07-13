"use client";

import { useRef, useState } from "react";
import { CameraIcon, PlusIcon } from "@phosphor-icons/react";

import {
  useExpenseLog,
  type ExpenseLog,
  type ReceiptLogSession,
} from "@/hooks/useExpenseLog";
import { friendlyError } from "@/lib/format";

import { ReceiptReviewSheet } from "./ReceiptReviewSheet";

/**
 * Expense logging affordance on the dashboard. Two paths:
 *   - Primary: Snap receipt → compressed → Gemini OCR + classify → 3-step
 *     review sheet → save + upload image.
 *   - Fallback (collapsed): text-only "log without a receipt" for cash-in-hand
 *     spends.
 *
 * On save the parent handler (`onSaved`) closes the outer Log-expense modal
 * and flashes a toast; the row also appears in the activity feed via the
 * parent's page-level `useExpenseLog` refresh.
 */
export function ExpenseQuickAdd({
  familyWalletId,
  onSaved,
}: {
  familyWalletId: string | null;
  /** Called with the just-saved log so the parent can flash a toast and
   *  refresh the dashboard's activity feed. */
  onSaved?: (log: ExpenseLog) => void;
}) {
  const { logNote, logReceipt } = useExpenseLog(familyWalletId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPhotoInputRef = useRef<HTMLInputElement>(null);
  /** Resolves the file the user picks via `addPhotoInputRef`. Set by the
   *  addPhoto callback in ReceiptReviewSheet, awaited inside the change
   *  handler so the merge happens in the same async tick. */
  const addPhotoResolverRef = useRef<{
    resolve: (file: File | null) => void;
  } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [session, setSession] = useState<ReceiptLogSession | null>(null);

  const [showTextFallback, setShowTextFallback] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const openCamera = () => {
    if (!familyWalletId || scanning) return;
    setScanError(null);
    fileInputRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setScanError(null);
    try {
      const s = await logReceipt(file);
      setSession(s);
    } catch (err) {
      setScanError(friendlyError(err));
    } finally {
      setScanning(false);
    }
  };

  const onAddPhotoFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    const pending = addPhotoResolverRef.current;
    addPhotoResolverRef.current = null;
    pending?.resolve(file);
  };

  const requestAddPhoto = async () => {
    if (!session) return;
    const file = await new Promise<File | null>((resolve) => {
      addPhotoResolverRef.current = { resolve };
      addPhotoInputRef.current?.click();
    });
    if (!file) return;
    const merged = await session.addPhoto(file);
    setSession(merged);
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length === 0 || saving || !familyWalletId) return;
    setSaving(true);
    setNoteError(null);
    try {
      const log = await logNote(trimmed);
      setNote("");
      onSaved?.(log);
    } catch (err) {
      setNoteError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onFilePicked}
      />
      <input
        ref={addPhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onAddPhotoFilePicked}
      />

      <button
        type="button"
        onClick={openCamera}
        disabled={!familyWalletId || scanning}
        className="sobre-btn sobre-btn-primary"
        style={{
          width: "100%",
          padding: "14px 16px",
          fontSize: 15,
          fontWeight: 600,
          justifyContent: "center",
          opacity: !familyWalletId || scanning ? 0.6 : 1,
        }}
      >
        <CameraIcon size={18} weight="bold" />
        {scanning ? "Reading receipt…" : "Snap receipt"}
      </button>

      {scanError ? (
        <p
          className="mt-2 text-[12px]"
          style={{ color: "var(--sobre-danger)" }}
        >
          {scanError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowTextFallback((v) => !v)}
        className="sobre-btn sobre-btn-soft"
        style={{
          width: "100%",
          marginTop: 10,
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: 600,
          justifyContent: "center",
        }}
      >
        {showTextFallback ? "Hide" : "Log without a receipt"}
      </button>

      {showTextFallback ? (
        <form onSubmit={submitNote} className="sobre-input-group mt-3">
          <label htmlFor="expense-note">Note</label>
          <div className="flex items-stretch gap-2">
            <input
              id="expense-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              maxLength={200}
              disabled={saving || !familyWalletId}
              className="sobre-input flex-1"
              style={{ padding: "12px 14px", fontSize: 15 }}
            />
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
          </div>
        </form>
      ) : null}

      {noteError ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--sobre-danger)" }}>
          {noteError}
        </p>
      ) : null}

      {session ? (
        <ReceiptReviewSheet
          scan={session.scan}
          imageBlobs={session.imageBlobs}
          onClose={() => setSession(null)}
          onSave={async (payload) => {
            const log = await session.save(payload);
            setSession(null);
            onSaved?.(log);
          }}
          onRetake={openCamera}
          onAddPhoto={requestAddPhoto}
        />
      ) : null}
    </div>
  );
}
