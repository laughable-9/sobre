"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { toEnvelopeNames } from "@/components/sobre/EnvelopeNamesEditor";
import {
  SplitEditor,
  isValidSplit,
  splitsEqual,
  toSplit,
} from "@/components/sobre/SplitEditor";
import { useProposeSplit } from "@/hooks/useSplitProposalMutations";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function ReadOnly({
  percents,
  envelopeNames,
}: {
  percents: number[];
  envelopeNames: string[];
}) {
  const names = toEnvelopeNames(envelopeNames);
  return (
    <div className="text-sm space-y-1.5">
      {names.map((name, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span style={{ color: "var(--text-2)" }}>{name}</span>
          <span className="font-medium tabular" style={{ color: "var(--text-1)" }}>
            {percents[i] ?? 0}%
          </span>
        </div>
      ))}
      <p className="text-xs pt-1" style={{ color: "var(--text-3)" }}>
        Only the admin can change the split.
      </p>
    </div>
  );
}

/**
 * Admin sets the envelope split percentages. Pure Supabase write — saves
 * instantly with no FaceID and no fee. Each future deposit reads the
 * latest percentages and divides accordingly.
 */
export function EnvelopeSplitForm({
  userAddress,
  familyWalletId,
  isAdmin,
  current,
  envelopeNames,
  /** Live admin count from state.admin_count. 1 → direct write, >1 →
   *  the change goes through an all-admins-agree proposal instead. */
  adminCount,
  /** True when a pending proposal already exists on this family — the
   *  form must not accept a second edit while one is live. */
  hasPendingProposal,
  onSuccess,
  onProposalSent,
}: {
  userAddress: string | null;
  familyWalletId: string | null;
  isAdmin: boolean;
  current: number[];
  envelopeNames: string[];
  adminCount: number;
  hasPendingProposal: boolean;
  /** Fires when the change was applied instantly (single-admin path). */
  onSuccess: () => void;
  /** Fires when a proposal was created and is waiting on other admins. */
  onProposalSent?: () => void;
}) {
  const [split, setSplit] = useState(() => toSplit(current));

  const sig = useMemo(() => current.join(","), [current]);
  useEffect(() => {
    // Re-seed form on poll changes only when the split signature moves.
    // Intentional external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplit(toSplit(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const mutation = useCallback(
    async (next: [number, number, number]) => {
      if (!familyWalletId) throw new Error("No family wallet id.");
      const supabase = getSupabaseBrowserClient();
      const { data, error: updateErr } = await supabase
        .from("family_wallets")
        .update({ percents: next })
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
  const { run: saveSplit, pending: saving, error } = useSupabaseMutation(
    mutation,
  );
  const { propose, pending: proposing, error: proposeError } = useProposeSplit();
  const requiresProposal = adminCount > 1;

  if (!userAddress) return null;
  if (!isAdmin)
    return <ReadOnly percents={current} envelopeNames={envelopeNames} />;

  const dirty = !splitsEqual(split, toSplit(current));
  const valid = isValidSplit(split);
  const busy = saving || proposing;
  const disabled = busy || !valid || !dirty || !familyWalletId || hasPendingProposal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    try {
      if (requiresProposal) {
        const result = await propose(familyWalletId!, split);
        if (result.outcome === "created") onProposalSent?.();
        else if (result.outcome === "pending_exists")
          throw new Error("Another proposal is already waiting. Resolve it first.");
        else if (result.outcome === "not_admin")
          throw new Error("Only admins can propose split changes.");
      } else {
        await saveSplit(split);
        onSuccess();
      }
    } catch {
      // surfaced via hook error
    }
  };
  const combinedError = error ?? proposeError;

  const helperCopy = hasPendingProposal
    ? "Resolve the pending proposal above before changing the split."
    : requiresProposal
      ? "This household has multiple admins. Your change goes out as a proposal that every admin must approve."
      : "Changes apply to future deposits. Existing balances stay put. Saves instantly.";

  const buttonLabel = requiresProposal
    ? proposing
      ? "Sending proposal…"
      : "Send proposal"
    : saving
      ? "Saving…"
      : "Save split";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs -mt-1" style={{ color: "var(--text-3)" }}>
        {helperCopy}
      </p>
      <SplitEditor
        value={split}
        onChange={setSplit}
        disabled={busy || hasPendingProposal}
        labels={toEnvelopeNames(envelopeNames)}
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={disabled}
          className="sobre-btn sobre-btn-primary"
          style={{
            padding: "12px 18px",
            fontSize: 14,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {buttonLabel}
        </button>
        {combinedError ? (
          <span
            className="text-xs break-all"
            style={{ color: "var(--sobre-danger)" }}
          >
            {combinedError}
          </span>
        ) : null}
      </div>
    </form>
  );
}
