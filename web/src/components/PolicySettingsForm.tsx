"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Lock } from "lucide-react";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import type { WalletPolicyShape } from "@/lib/contract";
import { PHP_PER_USDC, STROOPS_PER_TOKEN } from "@/lib/config";
import { phpToStroops } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Which on-chain envelope slot each row edits. Savings (index 2) is
 *  always-locked by design; index 1 is admin-configurable. Groceries
 *  isn't gatable — it's the day-to-day envelope, and locking it would
 *  block every routine spend behind an approval flow. */
type LockableSlot = 1 | 2;
const SLOT_ENVELOPE_KEY: Record<LockableSlot, "Tuition" | "Savings"> = {
  1: "Tuition",
  2: "Savings",
};

/** Household policy editor. Explicit Save button — nothing writes back
 *  to Supabase until the admin taps Save. Emits its dirty state via
 *  `onDirtyChange` so the parent can prompt the "unsaved changes"
 *  confirm dialog on tab switch or Back.
 *
 *  Savings (envelope index 2) is client-enforced always-locked: the
 *  toggle renders disabled + on, and the save payload always includes
 *  "Savings" in `protected_envelopes` regardless of any draft state.
 */
export function PolicySettingsForm({
  familyWalletId,
  isAdmin,
  current,
  envelopeNames,
  onSuccess,
  onDirtyChange,
}: {
  familyWalletId: string | null;
  isAdmin: boolean;
  current: WalletPolicyShape;
  /** Display labels [Groceries, Tuition, Savings] from Supabase. Used
   *  for the row headings — if the admin renamed "Tuition" to "School",
   *  the row reads "School needs approval". */
  envelopeNames: string[];
  onSuccess?: () => void;
  /** Fires whenever the draft's dirty state flips. Parent uses this to
   *  gate tab-switch / Back navigation on a "save your changes?" confirm. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // Draft state. Populated from `current` on mount and any time a save
  // completes (via `resetDraftFrom`). Not synced back to `current` on
  // every render — that would clobber in-progress edits.
  const [limitDraft, setLimitDraft] = useState<string>(() =>
    stroopsToPhpString(current.dailyLimit),
  );
  const [limitEnabled, setLimitEnabled] = useState<boolean>(
    current.dailyLimit !== null,
  );
  const [tuitionLocked, setTuitionLocked] = useState<boolean>(
    current.protectedEnvelopes.includes("Tuition"),
  );
  // Savings toggle is a UI-only mirror. The save payload always writes
  // "Savings" into protected_envelopes regardless of this local value;
  // the toggle stays disabled-on to make the invariant visible.
  const [savingsLocked] = useState<boolean>(true);

  const draftLimitStroops = useMemo<bigint | null>(() => {
    if (!limitEnabled) return null;
    const raw = limitDraft.trim();
    if (raw.length === 0) return null;
    const parsed = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return phpToStroops(String(parsed));
  }, [limitEnabled, limitDraft]);

  const draftProtected = useMemo<WalletPolicyShape["protectedEnvelopes"]>(() => {
    const out: WalletPolicyShape["protectedEnvelopes"] = [];
    if (tuitionLocked) out.push("Tuition");
    if (savingsLocked) out.push("Savings");
    return out;
  }, [tuitionLocked, savingsLocked]);

  const dirty = useMemo(() => {
    if (draftLimitStroops !== current.dailyLimit) return true;
    const a = new Set(current.protectedEnvelopes);
    const b = new Set(draftProtected);
    if (a.size !== b.size) return true;
    for (const v of a) if (!b.has(v)) return true;
    return false;
  }, [draftLimitStroops, draftProtected, current]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const mutation = useCallback(async () => {
    if (!familyWalletId) throw new Error("No family wallet id.");
    const supabase = getSupabaseBrowserClient();
    const { data, error: updateErr } = await supabase
      .from("family_wallets")
      .update({
        policy_json: {
          require_all_sigs: current.requireAllSigs,
          daily_limit_stroops:
            draftLimitStroops === null ? null : draftLimitStroops.toString(),
          per_tx_threshold_stroops:
            current.perTxThreshold === null
              ? null
              : current.perTxThreshold.toString(),
          protected_envelopes: draftProtected,
        },
      })
      .eq("id", familyWalletId)
      .select("id")
      .maybeSingle();
    if (updateErr) throw new Error(updateErr.message);
    if (!data) {
      throw new Error("Couldn't save. Only the family admin can change this.");
    }
  }, [
    familyWalletId,
    current.requireAllSigs,
    current.perTxThreshold,
    draftLimitStroops,
    draftProtected,
  ]);
  const { run, pending, error } = useSupabaseMutation(mutation);

  const handleSave = async () => {
    if (!isAdmin || !dirty) return;
    try {
      await run();
      onSuccess?.();
    } catch {
      // Surfaced via `error` from the mutation hook.
    }
  };

  return (
    <div className="sobre-policy-stack">
      <PolicyRow
        tint="accent"
        icon={<Clock size={18} strokeWidth={2.2} />}
        title="Daily limit per admin"
        control={
          <Toggle
            checked={limitEnabled}
            onCheckedChange={(v) => isAdmin && setLimitEnabled(v)}
            disabled={!isAdmin}
            ariaLabel="Enable daily cashout limit"
            tint="accent"
          />
        }
      />
      {limitEnabled ? (
        <div className="sobre-policy-inline">
          <span
            className="text-[13px]"
            style={{ color: "var(--text-3)" }}
          >
            Amount
          </span>
          <div className="flex items-center gap-1">
            <span
              aria-hidden
              className="text-[14px]"
              style={{ color: "var(--text-3)" }}
            >
              ₱
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={limitDraft}
              onChange={(e) => setLimitDraft(e.target.value)}
              disabled={!isAdmin || pending}
              aria-label="Daily limit amount in pesos"
              style={{
                width: 96,
                fontSize: 14,
                fontVariantNumeric: "tabular-nums",
                color: "var(--text-1)",
                background: "transparent",
                border: "none",
                outline: "none",
                padding: "2px 0",
                borderBottom: "1px solid var(--border-strong)",
              }}
            />
          </div>
        </div>
      ) : null}

      {([1, 2] as LockableSlot[]).map((slot) => {
        const label = envelopeNames[slot] ?? SLOT_ENVELOPE_KEY[slot];
        const alwaysLocked = slot === 2;
        const locked = alwaysLocked ? true : tuitionLocked;
        return (
          <PolicyRow
            key={slot}
            tint={locked ? "danger" : "muted"}
            icon={<Lock size={18} strokeWidth={2.2} />}
            title={
              <>
                {label} needs approval
                {alwaysLocked ? (
                  <span
                    className="ml-2 text-[11px]"
                    style={{
                      color: "var(--text-3)",
                      fontWeight: 500,
                      letterSpacing: "0.01em",
                    }}
                  >
                    always locked
                  </span>
                ) : null}
              </>
            }
            control={
              <Toggle
                checked={locked}
                onCheckedChange={(v) => {
                  if (!isAdmin || alwaysLocked) return;
                  setTuitionLocked(v);
                }}
                disabled={!isAdmin || alwaysLocked}
                ariaLabel={`Lock ${label}`}
                tint="danger"
              />
            }
          />
        );
      })}

      {isAdmin ? (
        <div
          className="flex items-center gap-3 justify-end"
          style={{ marginTop: 4 }}
        >
          {error ? (
            <span
              className="text-[12px]"
              style={{ color: "var(--sobre-danger)" }}
            >
              {error}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || pending}
            className="sobre-btn sobre-btn-primary"
            style={{
              padding: "10px 18px",
              fontSize: 13,
              opacity: !dirty || pending ? 0.55 : 1,
              cursor: !dirty || pending ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PolicyRow({
  icon,
  title,
  control,
  tint,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  control: React.ReactNode;
  tint: "accent" | "danger" | "muted";
}) {
  return (
    <div className={`sobre-policy-row ${tint}`}>
      <div className={`sobre-policy-ic ${tint}`} aria-hidden>
        {icon}
      </div>
      <div
        className="flex-1 min-w-0 text-[14px] flex items-center flex-wrap"
        style={{ color: "var(--text-1)", fontWeight: 600 }}
      >
        {title}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** iOS-style toggle. `tint` swaps the on-state track color to match
 *  the row's semantic (accent green for the limit row, danger red for
 *  lock rows). */
function Toggle({
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
  tint,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  tint: "accent" | "danger";
}) {
  const trackOn =
    tint === "danger" ? "var(--sobre-danger)" : "var(--sobre-accent)";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => !disabled && onCheckedChange(!checked)}
      disabled={disabled}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        border: "none",
        padding: 2,
        background: checked ? trackOn : "var(--border-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 160ms ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          transition: "transform 160ms ease",
        }}
      />
    </button>
  );
}

function stroopsToPhpString(v: bigint | null): string {
  if (v === null) return "";
  const usdc = Number(v) / STROOPS_PER_TOKEN;
  const php = usdc * PHP_PER_USDC;
  return String(Math.round(php));
}
