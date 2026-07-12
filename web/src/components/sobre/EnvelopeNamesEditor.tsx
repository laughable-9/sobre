"use client";

import { useRef, useState } from "react";
import { Lock } from "lucide-react";

import { ENVELOPE_LABELS } from "@/lib/config";
import {
  DEFAULT_ICON_KEY_BY_SLOT,
  ENVELOPE_ICON_OPTIONS,
  renderEnvelopeIcon,
} from "@/lib/envelopeIcons";

export type EnvelopeNames = [string, string, string];
export type EnvelopeIcons = [string, string, string];
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

export const DEFAULT_ENVELOPE_ICONS: EnvelopeIcons = [
  DEFAULT_ICON_KEY_BY_SLOT[ENVELOPE_LABELS[0]],
  DEFAULT_ICON_KEY_BY_SLOT[ENVELOPE_LABELS[1]],
  DEFAULT_ICON_KEY_BY_SLOT[ENVELOPE_LABELS[2]],
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

export function toEnvelopeIcons(icons: string[]): EnvelopeIcons {
  return [
    icons[0] ?? DEFAULT_ENVELOPE_ICONS[0],
    icons[1] ?? DEFAULT_ENVELOPE_ICONS[1],
    icons[2] ?? DEFAULT_ENVELOPE_ICONS[2],
  ];
}

export function namesEqual(a: EnvelopeNames, b: EnvelopeNames): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function iconsEqual(a: EnvelopeIcons, b: EnvelopeIcons): boolean {
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
  icons,
  onChange,
  onIconsChange,
  disabled,
}: {
  value: EnvelopeNames;
  /** Icon key per envelope (matches keys in ENVELOPE_ICON_OPTIONS). Optional
   *  so existing callers that don't wire icons still render with defaults. */
  icons?: EnvelopeIcons;
  onChange: (next: EnvelopeNames) => void;
  onIconsChange?: (next: EnvelopeIcons) => void;
  disabled?: boolean;
}) {
  const resolvedIcons: EnvelopeIcons = icons ?? DEFAULT_ENVELOPE_ICONS;
  const [openIconPickerFor, setOpenIconPickerFor] = useState<number | null>(
    null,
  );

  const setNameAt = (i: number, text: string) => {
    if (i === SAVINGS_INDEX) return;
    const next: EnvelopeNames = [value[0], value[1], SAVINGS_NAME];
    next[i] = text.slice(0, MAX_ENVELOPE_NAME_LEN);
    onChange(next);
  };

  const setIconAt = (i: number, key: string) => {
    if (!onIconsChange) return;
    const next: EnvelopeIcons = [
      resolvedIcons[0],
      resolvedIcons[1],
      resolvedIcons[2],
    ];
    next[i] = key;
    onIconsChange(next);
    setOpenIconPickerFor(null);
  };

  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => {
        const isLocked = i === SAVINGS_INDEX;
        const slot = ENVELOPE_LABELS[i];
        const iconKey = resolvedIcons[i];
        return (
          <EnvelopeRow
            key={i}
            slot={slot}
            iconKey={iconKey}
            name={isLocked ? SAVINGS_NAME : value[i]}
            locked={isLocked}
            disabled={disabled}
            canPickIcon={Boolean(onIconsChange)}
            pickerOpen={openIconPickerFor === i}
            onOpenPicker={() =>
              setOpenIconPickerFor(openIconPickerFor === i ? null : i)
            }
            onClosePicker={() => setOpenIconPickerFor(null)}
            onPickIcon={(key) => setIconAt(i, key)}
            onNameChange={(text) => setNameAt(i, text)}
          />
        );
      })}
    </div>
  );
}

function EnvelopeRow({
  slot,
  iconKey,
  name,
  locked,
  disabled,
  canPickIcon,
  pickerOpen,
  onOpenPicker,
  onClosePicker,
  onPickIcon,
  onNameChange,
}: {
  slot: (typeof ENVELOPE_LABELS)[number];
  iconKey: string;
  name: string;
  locked: boolean;
  disabled?: boolean;
  canPickIcon: boolean;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onPickIcon: (key: string) => void;
  onNameChange: (text: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const disabledPicker = disabled || !canPickIcon;

  return (
    <div className="flex items-center gap-3 relative" ref={rowRef}>
      <button
        type="button"
        onClick={disabledPicker ? undefined : onOpenPicker}
        className="grid place-items-center shrink-0"
        disabled={disabledPicker}
        aria-label={disabledPicker ? undefined : `Change icon for ${name}`}
        title={disabledPicker ? undefined : "Change icon"}
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: "var(--accent-soft)",
          color: "var(--sobre-accent)",
          border: pickerOpen
            ? "1.5px solid var(--sobre-primary)"
            : "1.5px solid transparent",
          cursor: disabledPicker ? "default" : "pointer",
        }}
      >
        {renderEnvelopeIcon(iconKey, slot, 16)}
      </button>
      <div className="sobre-input-wrap flex-1">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled || locked}
          maxLength={MAX_ENVELOPE_NAME_LEN}
          className="sobre-input"
          style={{
            padding: "10px 12px",
            fontSize: 14,
            paddingRight: locked ? 88 : undefined,
            cursor: locked ? "not-allowed" : "text",
            background: locked ? "var(--surface-alt)" : undefined,
          }}
        />
        {locked ? (
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
      {pickerOpen ? (
        <div
          className="absolute z-20"
          style={{
            top: 40,
            left: 0,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "var(--shadow-md)",
            padding: 10,
            minWidth: 220,
          }}
          role="dialog"
          aria-label={`Pick icon for ${name}`}
        >
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(6, 32px)" }}
          >
            {ENVELOPE_ICON_OPTIONS.map((opt) => {
              const active = opt.key === iconKey;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onPickIcon(opt.key)}
                  title={opt.label}
                  aria-label={opt.label}
                  className="grid place-items-center"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: active
                      ? "var(--accent-soft)"
                      : "var(--surface-alt)",
                    color: active
                      ? "var(--sobre-accent)"
                      : "var(--text-2)",
                    border: active
                      ? "1.5px solid var(--sobre-accent)"
                      : "1.5px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {opt.render(16)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClosePicker}
            className="text-[11px] mt-2 w-full text-center"
            style={{ color: "var(--text-3)" }}
          >
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}
