"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  ImageSquareIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import type { ReceiptScan, ReceiptItem } from "@/lib/gemini";
import type { ReceiptSavePayload, ReceiptSaveItem } from "@/hooks/useExpenseLog";
import { useCurrency } from "@/lib/currency";
import { PHP_PER_USDC } from "@/lib/config";
import { phpToStroops } from "@/lib/format";
import {
  EXPENSE_CATEGORIES,
  envelopeForCategory,
} from "@/lib/expenseCategories";

import { ExpenseCategoryIcon } from "./ExpenseCategoryIcon";
import { Sheet } from "./Sheet";

type Step = 1 | 2 | 3;
const TOTAL_STEPS = 3;

/**
 * Three-step receipt review. Sticky title + step counter at top; navigation
 * lives at the bottom (Back + Next/Save). Content wrapper re-mounts on step
 * change via `key={step}` so the fade+slide CSS animation plays each time.
 *
 *   1. Confirm vendor + amount, plus a list of every extracted line item.
 *   2. Pick one or more categories (icon-labelled selectable grid).
 *   3. Auto note (editable) + summary card + Save.
 */
export function ReceiptReviewSheet({
  scan,
  imageBlobs,
  onClose,
  onSave,
  onRetake,
  onAddPhoto,
}: {
  scan: ReceiptScan;
  imageBlobs: Blob[];
  onClose: () => void;
  onSave: (payload: ReceiptSavePayload) => Promise<void>;
  onRetake: () => void;
  /** Add another photo of the same receipt. The parent runs Gemini in merge
   *  mode and re-opens the sheet with the updated session. */
  onAddPhoto?: () => Promise<void> | void;
}) {
  const { currency } = useCurrency();
  const isUsd = currency === "USD";

  const [step, setStep] = useState<Step>(1);
  const [vendor, setVendor] = useState<string>(scan.vendor ?? "");
  const [amountStr, setAmountStr] = useState<string>(() => {
    if (scan.amount_php === null) return "";
    if (isUsd) return (scan.amount_php / PHP_PER_USDC).toFixed(2);
    return scan.amount_php.toFixed(2);
  });
  const [categories, setCategories] = useState<string[]>(
    scan.category ? [scan.category] : [],
  );
  const [items, setItems] = useState<ReceiptItem[]>(scan.items);
  const [note, setNote] = useState<string>(scan.note_summary);
  const [saving, setSaving] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blob URLs need to be created + revoked inside a single effect run so
  // React 19's StrictMode dev double-invoke doesn't leave a revoked URL
  // bound to <img src>. The useMemo + separate revoke pattern would work in
  // prod but 404s in dev (revoked between the simulated unmount/remount).
  // Depend on the first blob's identity, not the whole imageBlobs array —
  // addPhoto rebuilds the array on every merge and the memo would churn.
  const firstBlob = imageBlobs[0] ?? null;
  const [previewUrl, setPreviewUrl] = useState<string>("");
  useEffect(() => {
    if (!firstBlob) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(firstBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstBlob]);

  const amountStroops = useMemo(() => {
    const raw = amountStr.replace(/,/g, "").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const asPhp = isUsd ? n * PHP_PER_USDC : n;
    return phpToStroops(String(asPhp));
  }, [amountStr, isUsd]);

  const primaryAmountLabel = useMemo(() => {
    const raw = amountStr.replace(/,/g, "").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${isUsd ? "$" : "₱"}${n.toLocaleString(isUsd ? "en-US" : "en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }, [amountStr, isUsd]);

  const secondaryHint = useMemo(() => {
    const raw = amountStr.replace(/,/g, "").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (isUsd) {
      const php = n * PHP_PER_USDC;
      return `≈ ₱${php.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    const usd = n / PHP_PER_USDC;
    return `≈ $${usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }, [amountStr, isUsd]);

  /** What's missing on the current step. Surfaced as the Next button's
   *  helper text so tapping a disabled Next doesn't silently do nothing.
   *  Also serves as the "is this step valid" check — null means valid. */
  const stepMissing = (s: Step): string | null => {
    if (s === 1) {
      if (vendor.trim().length === 0 && amountStroops === null) {
        return "Add a vendor name and total to continue.";
      }
      if (vendor.trim().length === 0) return "Add a vendor name to continue.";
      if (amountStroops === null) return "Enter the total to continue.";
      return null;
    }
    if (s === 2) {
      return categories.length === 0 ? "Pick at least one category." : null;
    }
    return note.trim().length === 0 ? "Add a short note to save." : null;
  };

  const goBack = () => {
    if (saving) return;
    setError(null);
    if (step === 1) {
      onClose();
      return;
    }
    setStep((s) => (s - 1) as Step);
  };

  const goNext = () => {
    const missing = stepMissing(step);
    if (missing) {
      setError(missing);
      return;
    }
    setError(null);
    setStep((s) => (s + 1) as Step);
  };

  const save = async () => {
    const missing = stepMissing(3);
    if (missing || amountStroops === null) {
      setError(missing ?? "Missing amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saveItems: ReceiptSaveItem[] = items
        .filter((it) => it.description.trim().length > 0)
        .map((it) => ({
          description: it.description.trim(),
          qty: it.qty > 0 ? it.qty : 1,
          unit_price_stroops: phpToStroops(String(it.unit_price_php || 0)),
          category: it.category,
        }));
      const subtotalStroops =
        scan.subtotal_php !== null ? phpToStroops(String(scan.subtotal_php)) : null;
      const taxStroops =
        scan.tax_php !== null ? phpToStroops(String(scan.tax_php)) : null;
      const primaryCategory = categories[0] ?? null;
      const payload: ReceiptSavePayload = {
        note: note.trim().slice(0, 200),
        vendor: vendor.trim() || null,
        amount_stroops: amountStroops,
        subtotal_stroops: subtotalStroops,
        tax_stroops: taxStroops,
        envelope_index: envelopeForCategory(primaryCategory),
        category: categories.length > 0 ? categories : null,
        occurred_at: scan.occurred_at,
        items: saveItems.length > 0 ? saveItems : null,
        classifier: scan,
        imageBlobs,
      };
      await onSave(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Sheet
      onClose={onClose}
      canClose={!saving}
      ariaLabel="Review receipt"
      className="sobre-receipt-review"
    >
      <style>{`
        @keyframes sobre-step-in {
          from { opacity: 0; transform: translateX(12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .sobre-step-anim { animation: sobre-step-in 220ms ease-out; }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 520 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 22,
          }}
        >
          <h2 style={{ margin: 0, flex: 1 }}>Review receipt</h2>
          <span
            className="tabular"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-3)",
            }}
          >
            {step}/{TOTAL_STEPS}
          </span>
        </div>

        <div key={step} className="sobre-step-anim" style={{ flex: 1 }}>
          {step === 1 ? (
            <Step1
              previewUrl={previewUrl}
              photoCount={imageBlobs.length}
              vendor={vendor}
              setVendor={setVendor}
              amountStr={amountStr}
              setAmountStr={setAmountStr}
              secondaryHint={secondaryHint}
              isUsd={isUsd}
              items={items}
              setItems={setItems}
              defaultItemCategory={categories[0] ?? "Other"}
              disabled={saving || addingPhoto}
              addingPhoto={addingPhoto}
              onRetake={() => {
                onRetake();
                onClose();
              }}
              onAddPhoto={
                onAddPhoto
                  ? async () => {
                      setAddingPhoto(true);
                      setError(null);
                      try {
                        await onAddPhoto();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setAddingPhoto(false);
                      }
                    }
                  : undefined
              }
            />
          ) : null}
          {step === 2 ? (
            <Step2
              categories={categories}
              setCategories={setCategories}
              disabled={saving}
            />
          ) : null}
          {step === 3 ? (
            <Step3
              note={note}
              setNote={setNote}
              disabled={saving}
              vendor={vendor}
              primaryAmountLabel={primaryAmountLabel ?? ""}
              secondaryHint={secondaryHint}
              items={items}
              categories={categories}
            />
          ) : null}
        </div>

        {error ? (
          <p
            className="text-xs break-all"
            style={{ color: "var(--sobre-danger)", marginTop: 10 }}
          >
            {error}
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 32,
          }}
        >
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={goBack}
            disabled={saving}
            style={{ flex: 1 }}
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              className="sobre-btn sobre-btn-primary"
              disabled={saving}
              onClick={(e) => {
                // Blur so the button doesn't stay stuck in its :focus /
                // sticky-tap color state after an invalid Next.
                e.currentTarget.blur();
                goNext();
              }}
              style={{ flex: 2 }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="sobre-btn sobre-btn-primary"
              disabled={saving}
              onClick={(e) => {
                e.currentTarget.blur();
                void save();
              }}
              style={{ flex: 2 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Step1({
  previewUrl,
  photoCount,
  vendor,
  setVendor,
  amountStr,
  setAmountStr,
  secondaryHint,
  isUsd,
  items,
  setItems,
  defaultItemCategory,
  disabled,
  addingPhoto,
  onRetake,
  onAddPhoto,
}: {
  previewUrl: string;
  photoCount: number;
  vendor: string;
  setVendor: (v: string) => void;
  amountStr: string;
  setAmountStr: (v: string) => void;
  secondaryHint: string | null;
  isUsd: boolean;
  items: ReceiptItem[];
  setItems: (v: ReceiptItem[]) => void;
  defaultItemCategory: string;
  disabled: boolean;
  addingPhoto: boolean;
  onRetake: () => void;
  onAddPhoto?: () => void;
}) {
  const updateItem = (i: number, patch: Partial<ReceiptItem>) => {
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };
  const removeItem = (i: number) => {
    setItems(items.filter((_, idx) => idx !== i));
  };
  const addItem = () => {
    setItems([
      ...items,
      {
        description: "",
        qty: 1,
        unit_price_php: 0,
        category: defaultItemCategory as ReceiptItem["category"],
      },
    ]);
  };
  const symbol = isUsd ? "$" : "₱";
  const [editingVendor, setEditingVendor] = useState(false);
  const isManual = photoCount === 0;
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          padding: 14,
          background: "var(--sobre-surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          marginBottom: 18,
        }}
      >
        {isManual ? null : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Receipt"
            style={{
              width: 76,
              height: 100,
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid var(--border)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              flexShrink: 0,
              background: "var(--surface)",
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 76,
              height: 100,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingVendor ? (
            <input
              autoFocus
              value={vendor}
              onChange={(e) => setVendor(e.target.value.slice(0, 80))}
              onBlur={() => setEditingVendor(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              disabled={disabled}
              style={{
                fontFamily: "var(--serif)",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-1)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "2px 8px",
                background: "var(--surface)",
                width: "100%",
                marginBottom: 8,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => !disabled && setEditingVendor(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--serif)",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-1)",
                lineHeight: 1.15,
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: disabled ? "default" : "pointer",
                marginBottom: 4,
                textAlign: "left",
                maxWidth: "100%",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}
              >
                {vendor || "Vendor name"}
              </span>
              <PencilSimpleIcon size={12} weight="bold" style={{ color: "var(--text-3)" }} />
            </button>
          )}
          {photoCount > 1 ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                marginBottom: 10,
                letterSpacing: "0.02em",
              }}
            >
              {photoCount} photos merged
            </div>
          ) : null}
          {isManual ? (
            onAddPhoto ? (
              <button
                type="button"
                onClick={onAddPhoto}
                disabled={disabled}
                title="Attach a receipt photo to auto-fill the amount and items."
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  width: "100%",
                  padding: "18px 12px",
                  background: "var(--surface)",
                  border: "1.5px dashed var(--border)",
                  borderRadius: 10,
                  color: "var(--text-3)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  marginTop: 6,
                }}
              >
                <ImageSquareIcon size={18} weight="regular" />
                {addingPhoto ? "Reading…" : "Attach receipt photo"}
              </button>
            ) : null
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button
                  type="button"
                  onClick={onRetake}
                  disabled={disabled}
                  className="sobre-btn sobre-btn-soft"
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    height: "auto",
                    gap: 6,
                  }}
                >
                  <ArrowClockwiseIcon size={12} weight="bold" />
                  Retake
                </button>
                {onAddPhoto ? (
                  <button
                    type="button"
                    onClick={onAddPhoto}
                    disabled={disabled}
                    className="sobre-btn sobre-btn-soft"
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      height: "auto",
                      gap: 6,
                    }}
                    title="Snap another shot of this same receipt. Sobre merges it in."
                  >
                    <ImageSquareIcon size={14} weight="regular" />
                    {addingPhoto ? "Reading…" : "More of this receipt"}
                  </button>
                ) : null}
              </div>
              {onAddPhoto && photoCount === 1 ? (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    marginTop: 8,
                    lineHeight: 1.35,
                  }}
                >
                  Long receipt? Snap the rest and Sobre merges them.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label
          htmlFor="receipt-amount"
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          Total ({isUsd ? "USD" : "PHP"})
        </label>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            padding: "16px 18px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <span
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: "var(--text-3)",
              lineHeight: 1,
            }}
          >
            {symbol}
          </span>
          <input
            id="receipt-amount"
            className="tabular"
            type="number"
            inputMode="decimal"
            min="0"
            step={isUsd ? "0.01" : "1"}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={disabled}
            style={{
              flex: 1,
              fontSize: 30,
              fontWeight: 600,
              color: "var(--text-1)",
              background: "transparent",
              border: "none",
              outline: "none",
              minWidth: 0,
              padding: 0,
              letterSpacing: "-0.01em",
            }}
          />
        </div>
        {secondaryHint ? (
          <div
            className="tabular"
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              marginTop: 6,
              textAlign: "right",
            }}
          >
            {secondaryHint}
          </div>
        ) : null}
      </div>

      <ItemsSection
        items={items}
        onUpdate={updateItem}
        onRemove={removeItem}
        onAdd={addItem}
        disabled={disabled}
      />
    </>
  );
}

function ItemsSection({
  items,
  onUpdate,
  onRemove,
  onAdd,
  disabled,
}: {
  items: ReceiptItem[];
  onUpdate: (i: number, patch: Partial<ReceiptItem>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Items
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            disabled={disabled}
            aria-label={editing ? "Done editing items" : "Edit items"}
            title={editing ? "Done" : "Edit"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: editing ? "var(--accent-soft)" : "var(--surface)",
              color: editing ? "var(--sobre-accent)" : "var(--text-2)",
              fontSize: 11,
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {editing ? (
              <>
                <CheckIcon size={11} weight="bold" />
                Done
              </>
            ) : (
              <>
                <PencilSimpleIcon size={11} weight="bold" />
                Edit
              </>
            )}
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
            maxHeight: 240,
            overflowY: "auto",
            marginBottom: editing ? 8 : 0,
          }}
        >
          {items.map((it, i) =>
            editing ? (
              <EditableRow
                key={i}
                item={it}
                first={i === 0}
                disabled={disabled}
                onUpdate={(patch) => onUpdate(i, patch)}
                onRemove={() => onRemove(i)}
              />
            ) : (
              <ReadRow key={i} item={it} first={i === 0} />
            ),
          )}
        </div>
      ) : editing ? (
        <div
          style={{
            padding: "12px 14px",
            border: "1px dashed var(--border)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--text-3)",
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          No items yet. Add one below.
        </div>
      ) : (
        <div
          style={{
            padding: "12px 14px",
            border: "1px dashed var(--border)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--text-3)",
            textAlign: "center",
          }}
        >
          No items detected. Tap Edit to add some.
        </div>
      )}

      {editing ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="sobre-btn sobre-btn-soft"
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 600,
            justifyContent: "center",
            gap: 6,
          }}
        >
          <PlusIcon size={13} weight="bold" />
          Add item
        </button>
      ) : null}
    </div>
  );
}

function ReadRow({ item, first }: { item: ReceiptItem; first: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderTop: first ? "none" : "1px solid var(--border)",
        fontSize: 13,
        background: "var(--surface)",
      }}
    >
      <span
        style={{
          flex: 1,
          color: "var(--text-1)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.description || "Untitled item"}
      </span>
      <span
        className="tabular"
        style={{ color: "var(--text-3)", fontSize: 12, whiteSpace: "nowrap" }}
      >
        {item.qty} × ₱{item.unit_price_php.toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </div>
  );
}

function EditableRow({
  item,
  first,
  disabled,
  onUpdate,
  onRemove,
}: {
  item: ReceiptItem;
  first: boolean;
  disabled: boolean;
  onUpdate: (patch: Partial<ReceiptItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 10px",
        borderTop: first ? "none" : "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <input
        type="text"
        value={item.description}
        onChange={(e) => onUpdate({ description: e.target.value.slice(0, 120) })}
        disabled={disabled}
        placeholder="Item"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: "var(--text-1)",
          background: "transparent",
          border: "none",
          outline: "none",
          padding: "4px 2px",
        }}
      />
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        value={item.qty}
        onChange={(e) => {
          const n = Number(e.target.value);
          onUpdate({ qty: Number.isFinite(n) && n > 0 ? n : 1 });
        }}
        disabled={disabled}
        className="tabular"
        style={{
          width: 40,
          fontSize: 12,
          color: "var(--text-2)",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 6,
          outline: "none",
          padding: "4px 6px",
          textAlign: "right",
        }}
      />
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>×</span>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>₱</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={item.unit_price_php}
        onChange={(e) => {
          const n = Number(e.target.value);
          onUpdate({
            unit_price_php: Number.isFinite(n) && n >= 0 ? n : 0,
          });
        }}
        disabled={disabled}
        className="tabular"
        style={{
          width: 72,
          fontSize: 12,
          color: "var(--text-2)",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 6,
          outline: "none",
          padding: "4px 6px",
          textAlign: "right",
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove item"
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          display: "grid",
          placeItems: "center",
          color: "var(--sobre-danger)",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        <TrashIcon size={12} weight="bold" />
      </button>
    </div>
  );
}

function Step2({
  categories,
  setCategories,
  disabled,
}: {
  categories: string[];
  setCategories: (v: string[]) => void;
  disabled: boolean;
}) {
  const toggle = (key: string) => {
    if (categories.includes(key)) {
      setCategories(categories.filter((k) => k !== key));
    } else {
      setCategories([...categories, key]);
    }
  };
  return (
    <>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-3)",
          marginBottom: 12,
          lineHeight: 1.4,
        }}
      >
        Pick one or more categories that fit this receipt.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: 8,
        }}
      >
        {EXPENSE_CATEGORIES.map((cat) => {
          const active = categories.includes(cat.key);
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => toggle(cat.key)}
              disabled={disabled}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "12px 8px",
                borderRadius: 12,
                border: active
                  ? "1.5px solid var(--sobre-primary)"
                  : "1px solid var(--border)",
                background: active
                  ? "var(--accent-soft)"
                  : "var(--surface)",
                color: active ? "var(--sobre-primary)" : "var(--text-1)",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all 120ms ease",
              }}
            >
              <ExpenseCategoryIcon
                category={cat.key}
                size={22}
                weight={active ? "fill" : "regular"}
              />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{cat.label}</span>
              {active ? (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: "var(--sobre-primary)",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <CheckIcon size={10} weight="bold" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Step3({
  note,
  setNote,
  disabled,
  vendor,
  primaryAmountLabel,
  secondaryHint,
  items,
  categories,
}: {
  note: string;
  setNote: (v: string) => void;
  disabled: boolean;
  vendor: string;
  primaryAmountLabel: string;
  secondaryHint: string | null;
  items: ReceiptItem[];
  categories: string[];
}) {
  const [itemsOpen, setItemsOpen] = useState(false);
  const itemCount = items.length;
  return (
    <>
      <div
        style={{
          position: "relative",
          padding: "18px 20px 16px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          marginBottom: 16,
          boxShadow: "0 2px 8px rgba(28, 60, 45, 0.06)",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 4,
            background: "var(--sobre-primary)",
          }}
        />
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text-1)",
            lineHeight: 1.15,
            marginBottom: 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {vendor || "Receipt"}
        </div>
        <div
          className="tabular"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "var(--text-1)",
              letterSpacing: "-0.02em",
            }}
          >
            {primaryAmountLabel}
          </span>
          {secondaryHint ? (
            <span style={{ fontSize: 13, color: "var(--text-3)" }}>
              {secondaryHint}
            </span>
          ) : null}
        </div>
        {categories.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: itemCount > 0 ? 10 : 0,
            }}
          >
            {categories.map((c) => (
              <span
                key={c}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--sobre-accent)",
                  background: "var(--accent-soft)",
                  padding: "4px 10px",
                  borderRadius: 999,
                }}
              >
                <ExpenseCategoryIcon category={c} size={12} weight="bold" />
                {c}
              </span>
            ))}
          </div>
        ) : null}
        {itemCount > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setItemsOpen((v) => !v)}
              aria-expanded={itemsOpen}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                border: 0,
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-3)",
                cursor: "pointer",
              }}
            >
              {itemCount} {itemCount === 1 ? "item" : "items"}
              <CaretDownIcon
                size={11}
                weight="bold"
                style={{
                  transform: itemsOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 140ms ease",
                }}
              />
            </button>
            {itemsOpen ? (
              <div
                className="sobre-expand-in"
                style={{
                  marginTop: 8,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  maxHeight: 180,
                  overflowY: "auto",
                  background: "var(--surface)",
                }}
              >
                {items.map((it, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        color: "var(--text-1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.description || "Untitled item"}
                    </span>
                    <span
                      className="tabular"
                      style={{
                        color: "var(--text-3)",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.qty} × ₱
                      {it.unit_price_php.toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="sobre-input-group">
        <label htmlFor="receipt-note">Note</label>
        <textarea
          id="receipt-note"
          className="sobre-input"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          disabled={disabled}
          rows={3}
          style={{ resize: "none", padding: "10px 12px", fontSize: 14 }}
        />
      </div>
    </>
  );
}
