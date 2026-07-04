"use client";

import { useCurrency } from "@/lib/currency";

/**
 * Global PHP | USD segmented switch. Reads/writes the CurrencyContext so every
 * balance surface (total, envelope cards, summary) follows it. Pill-shaped,
 * thumb-target sized for mobile.
 */
export function CurrencyToggle() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      role="radiogroup"
      aria-label="Display currency"
      className="inline-flex select-none items-center"
      style={{
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: 3,
        flexShrink: 0,
      }}
    >
      {(["PHP", "USD"] as const).map((c) => {
        const active = currency === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={active ? undefined : () => setCurrency(c)}
            className="tabular text-[13px] font-semibold"
            style={{
              minWidth: 44,
              padding: "5px 13px",
              borderRadius: 999,
              border: "none",
              cursor: active ? "default" : "pointer",
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text-1)" : "var(--text-3)",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
