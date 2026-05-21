"use client";

import { ENVELOPE_LABELS } from "@/lib/config";

export type EnvelopeNames = [string, string, string];
export const MAX_ENVELOPE_NAME_LEN = 24;

export const DEFAULT_ENVELOPE_NAMES: EnvelopeNames = [
  ENVELOPE_LABELS[0],
  ENVELOPE_LABELS[1],
  ENVELOPE_LABELS[2],
];

export function toEnvelopeNames(names: string[]): EnvelopeNames {
  return [
    names[0] ?? DEFAULT_ENVELOPE_NAMES[0],
    names[1] ?? DEFAULT_ENVELOPE_NAMES[1],
    names[2] ?? DEFAULT_ENVELOPE_NAMES[2],
  ];
}

export function namesEqual(a: EnvelopeNames, b: EnvelopeNames): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function isValidEnvelopeNames(names: EnvelopeNames): boolean {
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
    const next: EnvelopeNames = [value[0], value[1], value[2]];
    next[i] = text.slice(0, MAX_ENVELOPE_NAME_LEN);
    onChange(next);
  };

  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
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
          <input
            type="text"
            value={value[i]}
            onChange={(e) => setAt(i, e.target.value)}
            disabled={disabled}
            maxLength={MAX_ENVELOPE_NAME_LEN}
            placeholder={DEFAULT_ENVELOPE_NAMES[i]}
            className="sobre-input flex-1"
            style={{ padding: "10px 12px", fontSize: 14 }}
          />
        </div>
      ))}
    </div>
  );
}
