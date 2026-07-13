"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, PencilSimpleIcon } from "@phosphor-icons/react";

import {
  useExpenseLog,
  type ExpenseLog,
  type ReceiptLogSession,
} from "@/hooks/useExpenseLog";
import { friendlyError } from "@/lib/format";

import { ReceiptReviewSheet } from "./ReceiptReviewSheet";

/**
 * Expense logging affordance on the dashboard. Two paths, both land in
 * the same 3-step review wizard:
 *   - Snap receipt → Gemini OCR pre-fills the wizard, user edits + saves.
 *   - Log without receipt → wizard opens blank; user types amount, items,
 *     categories, note. Can still attach a photo mid-flow via the review
 *     sheet's "Attach receipt photo" affordance.
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
  const { logReceipt, startManualEntry } = useExpenseLog(familyWalletId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPhotoInputRef = useRef<HTMLInputElement>(null);
  const addPhotoResolverRef = useRef<{
    resolve: (file: File | null) => void;
  } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [session, setSession] = useState<ReceiptLogSession | null>(null);

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

  // File inputs don't fire `change` when the picker is dismissed, so a
  // `cancel` listener resolves the pending Promise with null. Without
  // this the review sheet's "Reading…" state stays stuck forever after
  // a cancelled add-photo.
  useEffect(() => {
    const el = addPhotoInputRef.current;
    if (!el) return;
    const onCancel = () => {
      const pending = addPhotoResolverRef.current;
      addPhotoResolverRef.current = null;
      pending?.resolve(null);
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, []);

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

  const openManual = () => {
    if (!familyWalletId) return;
    setSession(startManualEntry());
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
        onClick={openManual}
        disabled={!familyWalletId}
        className="sobre-btn sobre-btn-soft"
        style={{
          width: "100%",
          marginTop: 10,
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: 600,
          justifyContent: "center",
          gap: 6,
        }}
      >
        <PencilSimpleIcon size={14} weight="bold" />
        Log without a receipt
      </button>

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
