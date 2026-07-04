"use client";

import { ENVELOPE_LABELS } from "@/lib/config";

export type Split = [number, number, number];

const PRESETS: { label: string; value: Split }[] = [
  { label: "50 / 30 / 20", value: [50, 30, 20] },
  { label: "Even", value: [34, 33, 33] },
  { label: "60 / 30 / 10", value: [60, 30, 10] },
];

export function isValidSplit(value: Split): boolean {
  return (
    value.every((n) => Number.isFinite(n) && n >= 0 && n <= 100 && Number.isInteger(n)) &&
    value[0] + value[1] + value[2] === 100
  );
}

export function toSplit(percents: number[]): Split {
  return [percents[0] ?? 0, percents[1] ?? 0, percents[2] ?? 0];
}

export function splitsEqual(a: Split, b: Split): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function SplitEditor({
  value,
  onChange,
  disabled,
  labels,
}: {
  value: Split;
  onChange: (next: Split) => void;
  disabled?: boolean;
  /** Row labels — defaults to the contract-side enum names. */
  labels?: readonly [string, string, string];
}) {
  const sum = value[0] + value[1] + value[2];
  const ok = sum === 100;

  const setAt = (i: number, n: number) => {
    // Empty field / non-numeric input yields NaN — coerce to 0 so it can't
    // slip past the clamp and poison the sum. Integers only, 0..100.
    const safe = Number.isFinite(n) ? n : 0;
    const clamped = Math.max(0, Math.min(100, Math.round(safe)));
    const next: Split = [value[0], value[1], value[2]];
    next[i] = clamped;
    onChange(next);
  };

  return (
    <div className="space-y-2.5">
      <div
        className="flex justify-end tabular text-[12px] font-semibold whitespace-nowrap"
        style={{
          color: ok ? "var(--sobre-accent)" : "var(--sobre-danger)",
        }}
      >
        Total {sum}% {ok ? "✓" : "(needs 100%)"}
      </div>

      {(labels ?? ENVELOPE_LABELS).map((label, i) => (
        <div key={label} className="flex items-center gap-3">
          <div
            className="flex-1 text-[14px] font-medium"
            style={{ color: "var(--text-1)" }}
          >
            {label}
          </div>
          <div
            className="flex items-stretch overflow-hidden"
            style={{
              border: "1.5px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface)",
              width: 110,
            }}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={value[i]}
              onChange={(e) => setAt(i, Number(e.target.value))}
              disabled={disabled}
              className="tabular flex-1 text-right text-[15px] font-semibold"
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                padding: "8px 8px 8px 12px",
                color: "var(--text-1)",
                width: "100%",
              }}
            />
            <div
              className="grid place-items-center text-[13px]"
              style={{
                color: "var(--text-3)",
                padding: "0 10px",
                background: "var(--surface-alt)",
              }}
            >
              %
            </div>
          </div>
        </div>
      ))}

      <div className="flex gap-1.5 pt-1 overflow-x-auto">
        {PRESETS.map((p) => {
          const active = splitsEqual(p.value, value);
          return (
            <button
              key={p.label}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p.value)}
              className="text-[11px] font-medium whitespace-nowrap"
              style={{
                padding: "5px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? "var(--sobre-primary)" : "var(--border)"}`,
                color: active ? "var(--sobre-primary)" : "var(--text-2)",
                background: active ? "var(--surface-alt)" : "var(--surface)",
                cursor: disabled ? "not-allowed" : "pointer",
                flexShrink: 0,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
