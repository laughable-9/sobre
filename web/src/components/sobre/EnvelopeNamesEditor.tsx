"use client";

import { Lock } from "lucide-react";

import { ENVELOPE_LABELS } from "@/lib/config";

export type EnvelopeNames = [string, string, string];
export const MAX_ENVELOPE_NAME_LEN = 24;

/** The Savings envelope (third slot) is permanently named "Savings" — it's
 *  the long-horizon, APY-bearing envelope; renaming it would erode the
 *  semantics every other surface (policy lock, APY label, etc.) relies on. */
export const SAVINGS_INDEX = 2;
export const SAVINGS_NAME = "Savings";

export const DEFAULT_ENVELOPE_NAMES: EnvelopeNames = [
  ENVELOPE_LABELS[0],
  ENVELOPE_LABELS[1],
  SAVINGS_NAME,
];

/** Coerce the third slot to the canonical Savings name. Used in both the
 *  initial-state helper and the form submit paths so a stale or hand-edited
 *  value can't sneak past. */
export function lockSavings(names: EnvelopeNames): EnvelopeNames {
  return [names[0], names[1], SAVINGS_NAME];
}

export function toEnvelopeNames(names: string[]): EnvelopeNames {
  return [
    names[0] ?? DEFAULT_ENVELOPE_NAMES[0],
    names[1] ?? DEFAULT_ENVELOPE_NAMES[1],
    SAVINGS_NAME,
  ];
}

export function namesEqual(a: EnvelopeNames, b: EnvelopeNames): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function isValidEnvelopeNames(names: EnvelopeNames): boolean {
  if (names[SAVINGS_INDEX] !== SAVINGS_NAME) return false;
  return names.every(
    (n) => n.trim().length > 0 && n.length <= MAX_ENVELOPE_NAME_LEN,
  );
}

export function EnvelopeNamesEditor({
  value,
  onChange,
  disabled,
}: {
  value: EnvelopeNames;
  onChange: (next: EnvelopeNames) => void;
  disabled?: boolean;
}) {
  const setAt = (i: number, text: string) => {
    if (i === SAVINGS_INDEX) return;
    const next: EnvelopeNames = [value[0], value[1], SAVINGS_NAME];
    next[i] = text.slice(0, MAX_ENVELOPE_NAME_LEN);
    onChange(next);
  };

  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => {
        const isLocked = i === SAVINGS_INDEX;
        return (
          <div key={i} className="flex items-center gap-3">
            <div
              className="text-[11px] uppercase tracking-wider"
              style={{
                color: "var(--text-3)",
                fontWeight: 600,
                width: 28,
              }}
            >
              #{i + 1}
            </div>
            <div className="sobre-input-wrap flex-1">
              <input
                type="text"
                value={isLocked ? SAVINGS_NAME : value[i]}
                onChange={(e) => setAt(i, e.target.value)}
                disabled={disabled || isLocked}
                maxLength={MAX_ENVELOPE_NAME_LEN}
                placeholder={DEFAULT_ENVELOPE_NAMES[i]}
                className="sobre-input"
                style={{
                  padding: "10px 12px",
                  fontSize: 14,
                  paddingRight: isLocked ? 88 : undefined,
                  cursor: isLocked ? "not-allowed" : "text",
                  background: isLocked ? "var(--surface-alt)" : undefined,
                }}
              />
              {isLocked ? (
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[11px] font-medium"
                  style={{ color: "var(--text-3)" }}
                  title="Savings is the APY-bearing envelope and can't be renamed."
                >
                  <Lock size={11} strokeWidth={2.4} />
                  locked
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
