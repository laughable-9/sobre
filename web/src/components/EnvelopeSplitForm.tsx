"use client";

import { useEffect, useMemo, useState } from "react";

import {
  SplitEditor,
  isValidSplit,
  splitsEqual,
  toSplit,
} from "@/components/sobre/SplitEditor";
import { useSetEnvelopes } from "@/hooks/useSetEnvelopes";
import { ENVELOPE_LABELS } from "@/lib/config";

function ReadOnly({ percents }: { percents: number[] }) {
  return (
    <div className="text-sm space-y-1.5">
      {ENVELOPE_LABELS.map((env, i) => (
        <div key={env} className="flex justify-between gap-3">
          <span style={{ color: "var(--text-2)" }}>{env}</span>
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

export function EnvelopeSplitForm({
  userAddress,
  contractId,
  isAdmin,
  current,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
  isAdmin: boolean;
  current: number[];
  onSuccess: () => void;
}) {
  const [split, setSplit] = useState(() => toSplit(current));
  const { setEnvelopes, pending, error } = useSetEnvelopes(
    userAddress,
    contractId,
  );

  // Hash by the underlying values so the upstream poll's identity churn
  // doesn't clobber an in-progress edit every 3s.
  const sig = useMemo(() => current.join(","), [current]);
  useEffect(() => {
    setSplit(toSplit(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!userAddress) return null;
  if (!isAdmin) return <ReadOnly percents={current} />;

  const dirty = !splitsEqual(split, toSplit(current));
  const valid = isValidSplit(split);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !dirty) return;
    try {
      await setEnvelopes(split);
      onSuccess();
    } catch {
      /* surfaced via hook error */
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs -mt-1" style={{ color: "var(--text-3)" }}>
        Changes apply to future deposits. Existing balances stay put.
      </p>
      <SplitEditor value={split} onChange={setSplit} disabled={pending} />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending || !valid || !dirty}
          className="sobre-btn sobre-btn-primary"
          style={{
            padding: "12px 18px",
            fontSize: 14,
            opacity: pending || !valid || !dirty ? 0.5 : 1,
            cursor: pending || !valid || !dirty ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save split"}
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
