"use client";

import { useEffect, useMemo, useState } from "react";

import {
  EnvelopeNamesEditor,
  isValidEnvelopeNames,
  lockSavings,
  namesEqual,
  toEnvelopeNames,
  type EnvelopeNames,
} from "@/components/sobre/EnvelopeNamesEditor";
import { useSetEnvelopeNames } from "@/hooks/useSetEnvelopeNames";

function ReadOnly({ names }: { names: EnvelopeNames }) {
  return (
    <div className="text-sm space-y-1.5">
      {names.map((n, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span style={{ color: "var(--text-2)" }}>#{i + 1}</span>
          <span className="font-medium" style={{ color: "var(--text-1)" }}>
            {n}
          </span>
        </div>
      ))}
      <p className="text-xs pt-1" style={{ color: "var(--text-3)" }}>
        Only the admin can rename the envelopes.
      </p>
    </div>
  );
}

export function EnvelopeNamesForm({
  userAddress,
  contractId,
  isAdmin,
  current,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
  isAdmin: boolean;
  current: string[];
  onSuccess: () => void;
}) {
  const [names, setNames] = useState<EnvelopeNames>(() => toEnvelopeNames(current));
  const { setEnvelopeNames, pending, error } = useSetEnvelopeNames(
    userAddress,
    contractId,
  );

  // Re-sync from chain state on poll, but only when the underlying names
  // actually change (so a 3s poll doesn't keep clobbering an in-progress edit).
  const sig = useMemo(() => current.join("\n"), [current]);
  useEffect(() => {
    setNames(toEnvelopeNames(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!userAddress) return null;
  if (!isAdmin) return <ReadOnly names={toEnvelopeNames(current)} />;

  const trimmed: EnvelopeNames = lockSavings([
    names[0].trim(),
    names[1].trim(),
    names[2].trim(),
  ]);
  const valid = isValidEnvelopeNames(names);
  const dirty = !namesEqual(trimmed, toEnvelopeNames(current));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !dirty) return;
    try {
      await setEnvelopeNames(trimmed);
      onSuccess();
    } catch {
      /* surfaced via hook error */
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs -mt-1" style={{ color: "var(--text-3)" }}>
        Display only. Balances + pending requests stay attached to the same
        envelope slots.
      </p>
      <EnvelopeNamesEditor
        value={names}
        onChange={setNames}
        disabled={pending}
      />
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
          {pending ? "Saving…" : "Save names"}
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
