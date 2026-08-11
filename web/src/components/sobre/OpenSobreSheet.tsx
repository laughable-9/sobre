"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  NoteIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";

import { Sheet } from "@/components/sobre/Sheet";
import { RAMPS_AVAILABLE } from "@/lib/config";

/**
 * The "opened Sobre" — the action sheet that surfaces the four verbs a
 * member can act on. Triggered by tapping the center dock tile. Users of
 * Sobre think in terms of "opening the envelope" to move money in or out.
 * Reuses the app-wide .sobre-modal chrome, which already collapses to a
 * bottom sheet on mobile.
 */
export function OpenSobreSheet({
  onClose,
  onAddMoney,
  onLogExpense,
  onCashOut,
  onSend,
  disableSend,
}: {
  onClose: () => void;
  onAddMoney: () => void;
  onLogExpense: () => void;
  onCashOut: () => void;
  onSend: () => void;
  disableSend?: boolean;
}) {
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Sheet onClose={onClose} ariaLabel="Sobre actions">
        <div className="sobre-sheet-actions" data-tour="sobre-sheet-actions">
          <SheetAction
            label="Add money"
            hint={
              RAMPS_AVAILABLE
                ? "Deposit through PDAX"
                : "Deposit crypto to your Sobre"
            }
            Icon={ArrowDownIcon}
            onClick={act(onAddMoney)}
          />
          <SheetAction
            label="Cash out"
            hint={
              RAMPS_AVAILABLE
                ? "Withdraw to your bank"
                : "Withdraw to a crypto wallet"
            }
            Icon={ArrowUpIcon}
            onClick={act(onCashOut)}
          />
          <SheetAction
            label="Send"
            hint="Top up a family member"
            Icon={PaperPlaneTiltIcon}
            onClick={act(onSend)}
            disabled={disableSend}
          />
          <SheetAction
            label="Log expense"
            hint="Note a household expense"
            Icon={NoteIcon}
            onClick={act(onLogExpense)}
          />
        </div>
        {!RAMPS_AVAILABLE ? (
          <p
            style={{
              marginTop: 12,
              fontSize: 12,
              color: "var(--sobre-text-3)",
            }}
          >
            Bank transfers are unavailable right now.
          </p>
        ) : null}
    </Sheet>
  );
}

function SheetAction({
  label,
  hint,
  Icon,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  Icon: PhosphorIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sobre-sheet-action"
      disabled={disabled}
    >
      <span className="chip">
        <Icon weight="bold" size={20} />
      </span>
      <span className="body">
        <span className="label">{label}</span>
        <span className="hint">{hint}</span>
      </span>
    </button>
  );
}
