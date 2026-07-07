"use client";

import {
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  EnvelopeSimpleIcon,
  PencilSimpleLineIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

/**
 * v2 dashboard quick-action row — native-wallet tiles wired to the same
 * handlers the old SummaryCard buttons + tab bar used (nothing removed, just
 * moved): deposit, cash out, invite (admin-only), Supplementary. Settings
 * moved up next to the wallet title as its own icon button (see
 * sobre-v2-title in dashboard/[contractId]/page.tsx) since it isn't a
 * money action. Wrapped in the same card shell as the "This month" summary
 * (sobre-hsummary) so it reads as one more section on the dashboard, not a
 * bare floating row.
 */
export function QuickActions({
  onDeposit,
  onCashout,
  cashoutDisabled,
  onLogExpense,
  onEnvelopes,
  onInvite,
  onSubaccounts,
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
}) {
  return (
    <section className="sobre-hsummary" aria-label="Quick actions">
      <div className="sobre-hsummary-head">Actions</div>
      <div className="sobre-v2-actions" role="group" aria-label="Quick actions">
        <button type="button" className="sobre-v2-action" onClick={onDeposit}>
          <span className="chip">
            <ArrowLineDownIcon weight="fill" size={28} />
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
            <ArrowLineUpIcon weight="fill" size={28} />
          </span>
          <span className="name">Cash out</span>
        </button>

        <button type="button" className="sobre-v2-action" onClick={onLogExpense}>
          <span className="chip">
            <PencilSimpleLineIcon weight="fill" size={28} />
          </span>
          <span className="name">Log expense</span>
        </button>

        <button type="button" className="sobre-v2-action" onClick={onEnvelopes}>
          <span className="chip">
            <EnvelopeSimpleIcon weight="fill" size={28} />
          </span>
          <span className="name">Envelopes</span>
        </button>

        {onInvite ? (
          <button type="button" className="sobre-v2-action" onClick={onInvite}>
            <span className="chip">
              <UserPlusIcon weight="fill" size={28} />
            </span>
            <span className="name">Invite</span>
          </button>
        ) : null}

        <button type="button" className="sobre-v2-action" onClick={onSubaccounts}>
          <span className="chip">
            <UsersThreeIcon weight="fill" size={28} />
          </span>
          <span className="name">Supplementary</span>
        </button>
      </div>
    </section>
  );
}
