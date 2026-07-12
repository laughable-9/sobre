"use client";

import { ENVELOPE_LABELS } from "@/lib/config";
import {
  BAR_COLORS,
} from "@/components/sobre/EnvelopeSplitCard";
import { ENVELOPE_ICON_BY_NAME } from "@/components/sobre/EnvelopeCard";

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
  const displayLabels = labels ?? ENVELOPE_LABELS;

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
    <div className="space-y-3">
      {/* Visual preview — segmented bar in envelope colors so the split is
          immediately readable before the user scans the numeric rows. */}
      <div
        className="flex overflow-hidden"
        style={{
          height: 10,
          borderRadius: 999,
          background: "var(--surface-alt)",
        }}
        role="img"
        aria-label={`Split preview: ${value.join("/")}`}
      >
        {value.map((pct, i) =>
          pct > 0 ? (
            <span
              key={i}
              style={{
                width: `${pct}%`,
                background: BAR_COLORS[i],
                transition: "width 200ms ease",
              }}
            />
          ) : null,
        )}
      </div>

      {displayLabels.map((label, i) => (
        <div key={label} className="flex items-center gap-3">
          <span
            className="grid place-items-center shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: `${BAR_COLORS[i]}22`,
              color: BAR_COLORS[i],
            }}
            aria-hidden
          >
            {ENVELOPE_ICON_BY_NAME[ENVELOPE_LABELS[i]]}
          </span>
          <div
            className="flex-1 text-[14px] font-medium truncate"
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
              width: 96,
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
              aria-label={`${label} percent`}
              className="tabular flex-1 text-right text-[15px] font-semibold"
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                padding: "8px 4px 8px 12px",
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

      <div className="flex items-center gap-2 flex-wrap">
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
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${active ? "var(--sobre-primary)" : "var(--border)"}`,
                color: active ? "var(--sobre-primary)" : "var(--text-2)",
                background: active ? "var(--surface-alt)" : "var(--surface)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {p.label}
            </button>
          );
        })}
        {!ok ? (
          <span
            className="tabular text-[12px] font-medium ml-auto"
            style={{ color: "var(--sobre-danger)" }}
            role="status"
            aria-live="polite"
          >
            {sum < 100 ? `${100 - sum}% left` : `${sum - 100}% over`}
          </span>
        ) : null}
      </div>
    </div>
  );
}
