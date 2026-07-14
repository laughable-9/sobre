"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Clock, Lock, Pencil, X } from "lucide-react";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import type { WalletPolicyShape } from "@/lib/contract";
import { PHP_PER_USDC, STROOPS_PER_TOKEN } from "@/lib/config";
import { phpToStroops } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Envelope keys that can be flagged as "needs admin approval" for
 *  now: Tuition and Savings. Groceries stays open by design — it's the
 *  household's day-to-day spend, so gating it would just annoy families
 *  every time they buy ulam. */
const GATABLE_ENVELOPES = ["Tuition", "Savings"] as const;
type Gatable = (typeof GATABLE_ENVELOPES)[number];

/** Household policy editor. Saves to `family_wallets.policy_json` via a
 *  direct Supabase update; RLS gates the write to admins of the family.
 *  Non-admins see the same three rows with the affordances disabled.
 *
 *  The layout mirrors the marketing preview on the landing page: a
 *  labelled card with three rows plus a dashed hint at the bottom.
 *  Icons live in soft-tinted circles (green for the limit, danger-soft
 *  for locked envelopes).
 */
export function PolicySettingsForm({
  familyWalletId,
  isAdmin,
  current,
  envelopeNames,
  onSuccess,
}: {
  familyWalletId: string | null;
  isAdmin: boolean;
  current: WalletPolicyShape;
  /** Display labels [Groceries, Tuition, Savings] from Supabase. Used
   *  for the row headings — an admin who renamed "Tuition" to "School"
   *  sees "School needs approval". */
  envelopeNames: string[];
  onSuccess?: () => void;
}) {
  const groceriesLabel = envelopeNames[0] ?? "Groceries";
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState<string>(() =>
    stroopsToPhpString(current.dailyLimit),
  );
  const protectedSet = useMemo(
    () => new Set(current.protectedEnvelopes),
    [current.protectedEnvelopes],
  );

  const mutation = useCallback(
    async (next: WalletPolicyShape) => {
      if (!familyWalletId) throw new Error("No family wallet id.");
      const supabase = getSupabaseBrowserClient();
      const { data, error: updateErr } = await supabase
        .from("family_wallets")
        .update({
          policy_json: {
            require_all_sigs: next.requireAllSigs,
            daily_limit_stroops:
              next.dailyLimit === null ? null : next.dailyLimit.toString(),
            per_tx_threshold_stroops:
              next.perTxThreshold === null
                ? null
                : next.perTxThreshold.toString(),
            protected_envelopes: next.protectedEnvelopes,
          },
        })
        .eq("id", familyWalletId)
        .select("id")
        .maybeSingle();
      if (updateErr) throw new Error(updateErr.message);
      if (!data) {
        throw new Error("Couldn't save. Only the family admin can change this.");
      }
    },
    [familyWalletId],
  );
  const { run, pending, error } = useSupabaseMutation(mutation);

  const saveLimit = async () => {
    if (!isAdmin) return;
    const raw = limitDraft.trim();
    let next: bigint | null;
    if (raw.length === 0) {
      next = null;
    } else {
      const parsed = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(parsed) || parsed < 0) return;
      next = parsed === 0 ? null : phpToStroops(String(parsed));
    }
    try {
      await run({ ...current, dailyLimit: next });
      setEditingLimit(false);
      onSuccess?.();
    } catch {
      // Surfaced via `error` from the mutation hook.
    }
  };

  const toggleProtected = async (envelope: Gatable) => {
    if (!isAdmin) return;
    const nextSet = new Set(protectedSet);
    if (nextSet.has(envelope)) nextSet.delete(envelope);
    else nextSet.add(envelope);
    try {
      await run({
        ...current,
        protectedEnvelopes: Array.from(nextSet) as WalletPolicyShape["protectedEnvelopes"],
      });
      onSuccess?.();
    } catch {
      // Surfaced via `error`.
    }
  };

  return (
    <div className="sobre-policy-stack">
      <PolicyRow
        tint="accent"
        icon={<Clock size={18} strokeWidth={2.2} />}
        title="Daily limit per member"
        rightSlot={
          editingLimit && isAdmin ? (
            <div className="flex items-center gap-1">
              <span
                aria-hidden
                className="text-[13px]"
                style={{ color: "var(--text-3)" }}
              >
                ₱
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value)}
                aria-label="Daily limit amount in pesos"
                autoFocus
                disabled={pending}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveLimit();
                  } else if (e.key === "Escape") {
                    setEditingLimit(false);
                    setLimitDraft(stroopsToPhpString(current.dailyLimit));
                  }
                }}
                style={{
                  width: 78,
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-1)",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  padding: "2px 0",
                  borderBottom: "1px solid var(--border-strong)",
                }}
              />
              <button
                type="button"
                onClick={() => void saveLimit()}
                disabled={pending}
                aria-label="Save daily limit"
                className="grid place-items-center"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent-soft)",
                  color: "var(--sobre-accent)",
                  cursor: pending ? "not-allowed" : "pointer",
                }}
              >
                <Check size={13} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingLimit(false);
                  setLimitDraft(stroopsToPhpString(current.dailyLimit));
                }}
                disabled={pending}
                aria-label="Cancel"
                className="grid place-items-center"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  border: "none",
                  background: "var(--surface-alt)",
                  color: "var(--text-3)",
                  cursor: pending ? "not-allowed" : "pointer",
                }}
              >
                <X size={13} strokeWidth={2.4} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!isAdmin) return;
                setLimitDraft(stroopsToPhpString(current.dailyLimit));
                setEditingLimit(true);
              }}
              disabled={!isAdmin}
              className="sobre-policy-pill accent"
              style={{
                cursor: isAdmin ? "pointer" : "default",
              }}
            >
              {current.dailyLimit === null
                ? "No limit"
                : `₱ ${formatPhp(current.dailyLimit)}`}
              {isAdmin ? (
                <Pencil
                  size={10}
                  strokeWidth={2.4}
                  aria-hidden
                  style={{ marginLeft: 6, opacity: 0.7 }}
                />
              ) : null}
            </button>
          )
        }
      />

      {GATABLE_ENVELOPES.map((env) => {
        const locked = protectedSet.has(env);
        const label = envelopeNames[env === "Tuition" ? 1 : 2] ?? env;
        return (
          <PolicyRow
            key={env}
            tint={locked ? "danger" : "muted"}
            icon={<Lock size={18} strokeWidth={2.2} />}
            title={`${label} needs approval`}
            rightSlot={
              <button
                type="button"
                onClick={() => void toggleProtected(env)}
                disabled={!isAdmin || pending}
                aria-pressed={locked}
                className={`sobre-policy-pill ${locked ? "danger" : "muted"}`}
                style={{
                  cursor: isAdmin && !pending ? "pointer" : "default",
                }}
              >
                {locked ? "Locked" : "Open"}
              </button>
            }
          />
        );
      })}

      <div className="sobre-policy-hint">
        {groceriesLabel} stays open for small day-to-day spends.
      </div>

      {error ? (
        <p
          className="mt-2 text-[12px]"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PolicyRow({
  icon,
  title,
  rightSlot,
  tint,
}: {
  icon: React.ReactNode;
  title: string;
  rightSlot: React.ReactNode;
  /** Determines the icon-circle color: accent (green), danger (red), or
   *  muted (neutral gray) for open envelopes. */
  tint: "accent" | "danger" | "muted";
}) {
  return (
    <div className={`sobre-policy-row ${tint}`}>
      <div className={`sobre-policy-ic ${tint}`} aria-hidden>
        {icon}
      </div>
      <div
        className="flex-1 min-w-0 text-[14px]"
        style={{ color: "var(--text-1)", fontWeight: 600 }}
      >
        {title}
      </div>
      <div className="shrink-0">{rightSlot}</div>
    </div>
  );
}

function stroopsToPhpString(v: bigint | null): string {
  if (v === null) return "";
  const usdc = Number(v) / STROOPS_PER_TOKEN;
  const php = usdc * PHP_PER_USDC;
  return String(Math.round(php));
}

function formatPhp(v: bigint): string {
  const usdc = Number(v) / STROOPS_PER_TOKEN;
  const php = usdc * PHP_PER_USDC;
  return Math.round(php).toLocaleString("en-PH");
}
