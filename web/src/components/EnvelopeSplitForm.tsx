"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { toEnvelopeNames } from "@/components/sobre/EnvelopeNamesEditor";
import {
  SplitEditor,
  isValidSplit,
  splitsEqual,
  toSplit,
} from "@/components/sobre/SplitEditor";
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
  onSuccess,
}: {
  userAddress: string | null;
  familyWalletId: string | null;
  isAdmin: boolean;
  current: number[];
  envelopeNames: string[];
  onSuccess: () => void;
}) {
  const [split, setSplit] = useState(() => toSplit(current));

  const sig = useMemo(() => current.join(","), [current]);
  useEffect(() => {
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

  if (!userAddress) return null;
  if (!isAdmin)
    return <ReadOnly percents={current} envelopeNames={envelopeNames} />;

  const dirty = !splitsEqual(split, toSplit(current));
  const valid = isValidSplit(split);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !dirty || !familyWalletId) return;
    try {
      await saveSplit(split);
      onSuccess();
    } catch {
      // surfaced via hook error
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs -mt-1" style={{ color: "var(--text-3)" }}>
        Changes apply to future deposits. Existing balances stay put. Saves
        instantly.
      </p>
      <SplitEditor
        value={split}
        onChange={setSplit}
        disabled={saving}
        labels={toEnvelopeNames(envelopeNames)}
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || !valid || !dirty || !familyWalletId}
          className="sobre-btn sobre-btn-primary"
          style={{
            padding: "12px 18px",
            fontSize: 14,
            opacity:
              saving || !valid || !dirty || !familyWalletId ? 0.5 : 1,
            cursor:
              saving || !valid || !dirty || !familyWalletId
                ? "not-allowed"
                : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save split"}
        </button>
        {error ? (
          <span
            className="text-xs break-all"
            style={{ color: "var(--sobre-danger)" }}
          >
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
