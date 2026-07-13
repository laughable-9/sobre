"use client";

import { useCallback, useEffect, useState } from "react";

import { compressReceiptImage } from "@/lib/imageCompress";
import type { ReceiptScan } from "@/lib/gemini";

/** One line item as persisted to Postgres. Unit price is a stroops string
 *  (JSON transport can't carry bigints natively). */
export interface ExpenseLogItem {
  description: string;
  qty: number;
  unit_price_stroops: string;
  category: string;
}

export interface ExpenseLog {
  id: string;
  note: string;
  created_at: string;
  wallet_id: string;
  amount_stroops: string | number | null;
  subtotal_stroops: string | number | null;
  tax_stroops: string | number | null;
  envelope_index: 0 | 1 | 2 | null;
  vendor: string | null;
  category: string[] | null;
  receipt_paths: string[] | null;
  occurred_at: string | null;
  items: ExpenseLogItem[] | null;
  signed_receipt_urls?: string[] | null;
  /** First signed URL (back-compat with older single-image callers). */
  signed_receipt_url?: string | null;
}

/** Payload the ReceiptReviewSheet returns from its Save button. */
export interface ReceiptSaveItem {
  description: string;
  qty: number;
  unit_price_stroops: bigint;
  category: string;
}

export interface ReceiptSavePayload {
  note: string;
  vendor: string | null;
  amount_stroops: bigint | null;
  subtotal_stroops: bigint | null;
  tax_stroops: bigint | null;
  envelope_index: 0 | 1 | 2 | null;
  category: string[] | null;
  occurred_at: string | null;
  items: ReceiptSaveItem[] | null;
  classifier: ReceiptScan | null;
  /** Every image captured for this receipt (multi-photo support). */
  imageBlobs: Blob[];
}

/** Two-phase receipt logging. The first `logReceipt(file)` scan returns the
 *  initial parse. `addPhoto(file)` merges an additional photo (typically
 *  another slice of a long receipt) into the session's scan without
 *  double-counting items. `save(edited)` persists the confirmed row and
 *  uploads all captured images. */
export interface ReceiptLogSession {
  scan: ReceiptScan;
  envelopeNames: [string, string, string];
  imageBlobs: Blob[];
  addPhoto: (file: File) => Promise<ReceiptLogSession>;
  save: (edited: ReceiptSavePayload) => Promise<ExpenseLog>;
}

export interface UseExpenseLogResult {
  logs: ExpenseLog[];
  loading: boolean;
  error: string | null;
  /** Save a text-only note off-chain immediately. */
  logNote: (note: string) => Promise<ExpenseLog>;
  /** OCR + classify a receipt image. Returns a session that carries the
   *  merged scan across additional photos and a save() to persist. */
  logReceipt: (file: File) => Promise<ReceiptLogSession>;
  /** Undo: delete a row the caller authored. Also cleans the Storage objects. */
  deleteExpense: (id: string) => Promise<void>;
  refresh: () => void;
}

/**
 * Off-chain expense records for a family wallet. Backed by /api/expense-logs
 * (service-role + membership-gated). Two paths:
 *
 *   - text-only note ("What did you spend on?"): `logNote(note)`.
 *   - receipt scan (JPEG/PNG/WebP): `logReceipt(file)` returns a session
 *     that OCR+classifies via Gemini. The session's `addPhoto(file)` merges
 *     a second (or third) photo of the same receipt. `save(edited)` persists.
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
    fetch(`/api/expense-logs?family_wallet_id=${familyWalletId}&with_signed_urls=1`)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const persist = useCallback(
    async (payload: {
      note: string;
      amount_stroops?: bigint | null;
      subtotal_stroops?: bigint | null;
      tax_stroops?: bigint | null;
      envelope_index?: 0 | 1 | 2 | null;
      vendor?: string | null;
      category?: string[] | null;
      occurred_at?: string | null;
      items?: ReceiptSaveItem[] | null;
      classifier?: unknown;
      imageBlobs?: Blob[];
    }): Promise<ExpenseLog> => {
      if (!familyWalletId) throw new Error("No family wallet.");
      const body: Record<string, unknown> = {
        family_wallet_id: familyWalletId,
        note: payload.note,
      };
      if (payload.amount_stroops !== undefined && payload.amount_stroops !== null) {
        body.amount_stroops = payload.amount_stroops.toString();
      }
      if (payload.subtotal_stroops !== undefined && payload.subtotal_stroops !== null) {
        body.subtotal_stroops = payload.subtotal_stroops.toString();
      }
      if (payload.tax_stroops !== undefined && payload.tax_stroops !== null) {
        body.tax_stroops = payload.tax_stroops.toString();
      }
      if (payload.envelope_index !== undefined) body.envelope_index = payload.envelope_index;
      if (payload.vendor !== undefined) body.vendor = payload.vendor;
      if (payload.category !== undefined) body.category = payload.category;
      if (payload.occurred_at !== undefined) body.occurred_at = payload.occurred_at;
      if (payload.items !== undefined && payload.items !== null) {
        body.items = payload.items.map((it) => ({
          description: it.description,
          qty: it.qty,
          unit_price_stroops: it.unit_price_stroops.toString(),
          category: it.category,
        }));
      }
      if (payload.classifier !== undefined) body.classifier = payload.classifier;
      if (payload.imageBlobs && payload.imageBlobs.length > 0) {
        const encoded = await Promise.all(
          payload.imageBlobs.map(async (blob) => ({
            bytes_base64: await blobToBase64(blob),
            mime: blob.type || "image/jpeg",
          })),
        );
        body.receipt_images = encoded;
      }
      const res = await fetch("/api/expense-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { log } = (await res.json()) as { log: ExpenseLog };
      setLogs((prev) => [log, ...prev]);
      return log;
    },
    [familyWalletId],
  );

  const logNote = useCallback(
    (note: string): Promise<ExpenseLog> => persist({ note }),
    [persist],
  );

  /** Compress a file and send it to /scan, optionally merging into an
   *  existing session's scan across multiple photos. */
  const scanOne = useCallback(
    async (
      file: File,
      priorScan: ReceiptScan | null,
    ): Promise<{
      scan: ReceiptScan;
      envelopeNames: [string, string, string];
      blob: Blob;
    }> => {
      if (!familyWalletId) throw new Error("No family wallet.");
      const compressed = await compressReceiptImage(file);
      const form = new FormData();
      form.append("family_wallet_id", familyWalletId);
      form.append("image", compressed, "receipt.jpg");
      if (priorScan) {
        form.append("prior_scan", JSON.stringify(priorScan));
      }
      const res = await fetch("/api/expense-logs/scan", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { scan, envelope_names } = (await res.json()) as {
        scan: ReceiptScan;
        envelope_names: [string, string, string];
      };
      return { scan, envelopeNames: envelope_names, blob: compressed };
    },
    [familyWalletId],
  );

  const buildSession = useCallback(
    (
      scan: ReceiptScan,
      envelopeNames: [string, string, string],
      imageBlobs: Blob[],
    ): ReceiptLogSession => {
      const session: ReceiptLogSession = {
        scan,
        envelopeNames,
        imageBlobs,
        addPhoto: async (file) => {
          const { scan: merged, blob } = await scanOne(file, scan);
          return buildSession(merged, envelopeNames, [...imageBlobs, blob]);
        },
        // ReceiptSavePayload is a strict superset of persist's expected
        // shape — pass through directly.
        save: (edited) => persist(edited),
      };
      return session;
    },
    [persist, scanOne],
  );

  const logReceipt = useCallback(
    async (file: File): Promise<ReceiptLogSession> => {
      const { scan, envelopeNames, blob } = await scanOne(file, null);
      return buildSession(scan, envelopeNames, [blob]);
    },
    [buildSession, scanOne],
  );

  const deleteExpense = useCallback(
    async (id: string): Promise<void> => {
      if (!familyWalletId) return;
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

  return { logs, loading, error, logNote, logReceipt, deleteExpense, refresh };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(blob);
  });
}
