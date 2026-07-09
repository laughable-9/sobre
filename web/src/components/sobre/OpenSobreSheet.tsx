"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  NoteIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";

import { backdropClose } from "@/lib/ui";

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
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div
        className="sobre-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Sobre actions"
      >
        <div className="sobre-sheet-actions">
          <SheetAction
            label="Add money"
            hint="Deposit through PDAX"
            Icon={ArrowDownIcon}
            onClick={act(onAddMoney)}
          />
          <SheetAction
            label="Cash out"
            hint="Withdraw to your bank"
            Icon={ArrowUpIcon}
            onClick={act(onCashOut)}
          />
          <SheetAction
            label="Send"
            hint="From an envelope to a member"
            Icon={PaperPlaneTiltIcon}
            onClick={act(onSend)}
            disabled={disableSend}
          />
          <SheetAction
            label="Log expense"
            hint="Note a household spend"
            Icon={NoteIcon}
            onClick={act(onLogExpense)}
          />
        </div>
      </div>
    </div>
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
