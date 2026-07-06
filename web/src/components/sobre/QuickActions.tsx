"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Mail,
  PenLine,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";

/**
 * v2 dashboard quick-action row — native-wallet tiles wired to the same
 * handlers the old SummaryCard buttons + tab bar used (nothing removed, just
 * moved): deposit, cash out, invite (admin-only), Supplementary, Settings.
 * The tiles ARE the navigation now — the tab bar is gone.
 */
export function QuickActions({
  onDeposit,
  onCashout,
  cashoutDisabled,
  onLogExpense,
  onEnvelopes,
  onInvite,
  onSubaccounts,
  onSettings,
}: {
  onDeposit: () => void;
  onCashout: () => void;
  /** Mirror of the old "Cash out to bank" disabled state (zero balance). */
  cashoutDisabled?: boolean;
  /** Opens the off-chain "What did you spend on?" note modal. */
  onLogExpense: () => void;
  /** Opens the envelopes view (the cards moved off the home screen). */
  onEnvelopes: () => void;
  /** Present only for admins — hidden otherwise, same as the old invite pill. */
  onInvite?: () => void;
  onSubaccounts: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="sobre-v2-actions" role="group" aria-label="Quick actions">
      <button type="button" className="sobre-v2-action" onClick={onDeposit}>
        <span className="chip">
          <ArrowDownToLine size={19} strokeWidth={2} />
        </span>
        <span className="name">Add money</span>
      </button>

      <button
        type="button"
        className="sobre-v2-action"
        onClick={onCashout}
        disabled={cashoutDisabled}
      >
        <span className="chip">
          <ArrowUpFromLine size={19} strokeWidth={2} />
        </span>
        <span className="name">Cash out</span>
      </button>

      <button type="button" className="sobre-v2-action" onClick={onLogExpense}>
        <span className="chip">
          <PenLine size={19} strokeWidth={2} />
        </span>
        <span className="name">Log expense</span>
      </button>

      <button type="button" className="sobre-v2-action" onClick={onEnvelopes}>
        <span className="chip">
          <Mail size={19} strokeWidth={2} />
        </span>
        <span className="name">Envelopes</span>
      </button>

      {onInvite ? (
        <button type="button" className="sobre-v2-action" onClick={onInvite}>
          <span className="chip">
            <UserPlus size={19} strokeWidth={2} />
          </span>
          <span className="name">Invite</span>
        </button>
      ) : null}

      <button type="button" className="sobre-v2-action" onClick={onSubaccounts}>
        <span className="chip">
          <Users size={19} strokeWidth={2} />
        </span>
        <span className="name">Supplementary</span>
      </button>

      <button type="button" className="sobre-v2-action" onClick={onSettings}>
        <span className="chip">
          <Settings size={19} strokeWidth={2} />
        </span>
        <span className="name">Settings</span>
      </button>
    </div>
  );
}
