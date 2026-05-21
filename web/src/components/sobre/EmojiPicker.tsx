"use client";

export const SOBRE_EMOJIS = ["🥭", "🌴", "🌺", "💰", "⭐", "☀️"] as const;
export type SobreEmoji = (typeof SOBRE_EMOJIS)[number];

export function EmojiPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (e: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {SOBRE_EMOJIS.map((e) => {
        const active = e === value;
        return (
          <button
            key={e}
            type="button"
            onClick={() => onChange(e)}
            disabled={disabled}
            className="grid place-items-center text-[24px] transition-all"
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: active ? "var(--sobre-primary)" : "var(--surface-alt)",
              border: active
                ? "1.5px solid var(--sobre-primary)"
                : "1.5px solid var(--border)",
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
              boxShadow: active
                ? "0 4px 12px rgba(232, 146, 60, 0.3)"
                : "none",
            }}
            aria-pressed={active}
          >
            {e}
          </button>
        );
      })}
    </div>
  );
}
