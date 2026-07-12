"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_ENVELOPE_ICONS,
  EnvelopeNamesEditor,
  iconsEqual,
  isValidEnvelopeNames,
  lockSavings,
  namesEqual,
  toEnvelopeIcons,
  toEnvelopeNames,
  type EnvelopeIcons,
  type EnvelopeNames,
} from "@/components/sobre/EnvelopeNamesEditor";
import { renderEnvelopeIcon } from "@/lib/envelopeIcons";
import { ENVELOPE_LABELS } from "@/lib/config";
import { useSetEnvelopeNames } from "@/hooks/useSetEnvelopeNames";

function ReadOnly({
  names,
  icons,
}: {
  names: EnvelopeNames;
  icons: EnvelopeIcons;
}) {
  return (
    <div className="text-sm space-y-1.5">
      {names.map((n, i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className="grid place-items-center shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--accent-soft)",
              color: "var(--sobre-accent)",
            }}
            aria-hidden
          >
            {renderEnvelopeIcon(icons[i], ENVELOPE_LABELS[i], 14)}
          </span>
          <span className="font-medium flex-1" style={{ color: "var(--text-1)" }}>
            {n}
          </span>
        </div>
      ))}
      <p className="text-xs pt-1" style={{ color: "var(--text-3)" }}>
        Only the admin can rename or restyle the envelopes.
      </p>
    </div>
  );
}

/**
 * Envelope display names + icons live in Supabase only
 * (family_envelope_names). Renaming and restyling are instant + free —
 * no chain tx, no FaceID. The on-chain Envelope enum
 * (Groceries/Tuition/Savings) keys balances regardless.
 */
export function EnvelopeNamesForm({
  userAddress,
  familyWalletId,
  isAdmin,
  current,
  currentIcons,
  onSuccess,
}: {
  userAddress: string | null;
  familyWalletId: string | null;
  isAdmin: boolean;
  current: string[];
  currentIcons: string[];
  onSuccess: () => void;
}) {
  const [names, setNames] = useState<EnvelopeNames>(() => toEnvelopeNames(current));
  const [icons, setIcons] = useState<EnvelopeIcons>(() =>
    toEnvelopeIcons(currentIcons),
  );
  const { setEnvelopeNames, pending, error } = useSetEnvelopeNames(userAddress);

  // Re-sync from Supabase on every reload, but only when the underlying
  // names or icons actually change (so a poll doesn't keep clobbering an
  // in-progress edit).
  const sig = useMemo(
    () => `${current.join("\n")}::${currentIcons.join("\n")}`,
    [current, currentIcons],
  );
  useEffect(() => {
    setNames(toEnvelopeNames(current));
    setIcons(toEnvelopeIcons(currentIcons));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!userAddress) return null;
  if (!isAdmin) {
    return (
      <ReadOnly
        names={toEnvelopeNames(current)}
        icons={toEnvelopeIcons(currentIcons)}
      />
    );
  }

  const valid = isValidEnvelopeNames(names);
  const nameDirty = !namesEqual(
    [names[0].trim(), names[1].trim(), names[2].trim()],
    toEnvelopeNames(current),
  );
  const iconDirty = !iconsEqual(icons, toEnvelopeIcons(currentIcons));
  const dirty = nameDirty || iconDirty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !dirty || !familyWalletId) return;
    const trimmed = lockSavings([
      names[0].trim(),
      names[1].trim(),
      names[2].trim(),
    ]);
    const iconsToSave: EnvelopeIcons = [
      icons[0] || DEFAULT_ENVELOPE_ICONS[0],
      icons[1] || DEFAULT_ENVELOPE_ICONS[1],
      icons[2] || DEFAULT_ENVELOPE_ICONS[2],
    ];
    try {
      await setEnvelopeNames(familyWalletId, trimmed, iconsToSave);
      onSuccess();
    } catch {
      /* surfaced via hook error */
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs -mt-1" style={{ color: "var(--text-3)" }}>
        Display only. Balances + pending requests stay attached to the same
        envelope slots. Tap an icon to pick a different one.
      </p>
      <EnvelopeNamesEditor
        value={names}
        icons={icons}
        onChange={setNames}
        onIconsChange={setIcons}
        disabled={pending}
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending || !valid || !dirty || !familyWalletId}
          className="sobre-btn sobre-btn-primary"
          style={{
            padding: "12px 18px",
            fontSize: 14,
            opacity:
              pending || !valid || !dirty || !familyWalletId ? 0.5 : 1,
            cursor:
              pending || !valid || !dirty || !familyWalletId
                ? "not-allowed"
                : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save"}
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
