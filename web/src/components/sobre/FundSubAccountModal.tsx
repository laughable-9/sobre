"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { useCashoutApproval } from "@/hooks/useCashoutApproval";
import { useFundSubaccount } from "@/hooks/useFundSubaccount";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { envelopeTotalStroops } from "@/lib/walletTotals";

import { Avatar } from "./Avatar";
import { Sheet } from "./Sheet";

interface SubTarget {
  address: string;
  displayName: string;
}

interface Props {
  userAddress: string;
  contractId: string;
  state: WalletState;
  /** family_wallets.id + current admin's wallets.id — required for
   *  the multi-admin approval flow when the source envelope is
   *  locked. Nulls disable the approval gate (falls back to direct
   *  fund_subaccount), so callers should always thread these in for
   *  the real path. */
  familyWalletId: string | null;
  memberWalletDbId: string | null;
  /** Sub-account rows from Supabase — used to render display names + avatars
   *  in the recipient picker. Pending (unclaimed) invites are filtered out. */
  subRows: FamilySubaccountRow[];
  /** When set, the envelope is pre-selected and no picker is shown — the
   *  entry point was a specific envelope card. When null, the modal renders
   *  an envelope picker (entry point was a specific sub-account). */
  initialEnvelope?: EnvelopeName;
  /** When set, the recipient is pre-selected — the entry point was a
   *  specific sub-account card. When null, the modal renders a recipient
   *  picker (entry point was a specific envelope). */
  initialTarget?: SubTarget;
  onClose: () => void;
  onSuccess: () => void;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
}

/**
 * Admin-only. Moves USDC from a chosen envelope into a chosen sub-account's
 * spendable balance. One `fund_subaccount` contract call, no approval gate,
 * no pending step — the earlier "policy-gated top-up" flow is gone.
 *
 * Two entry points share this modal:
 *  - Envelope card → tap "Send to family member": envelope is fixed, user
 *    picks the recipient sub-account.
 *  - Sub-account card → tap "Send": recipient is fixed, user picks the
 *    envelope to draw from.
 */
export function FundSubAccountModal({
  userAddress,
  contractId,
  state,
  familyWalletId,
  memberWalletDbId,
  subRows,
  initialEnvelope,
  initialTarget,
  onClose,
  onSuccess,
  onFlash,
}: Props) {
  const [envelope, setEnvelope] = useState<EnvelopeName>(
    initialEnvelope ?? "Groceries",
  );
  const [target, setTarget] = useState<SubTarget | null>(
    initialTarget ?? null,
  );
  const [amount, setAmount] = useState<string>("500");
  const { fund, pending, error } = useFundSubaccount(userAddress, contractId);

  // Claimed sub-accounts only — pending invites have no on-chain address to
  // fund. Merged from Supabase (display names) and state (on-chain address).
  const availableTargets: SubTarget[] = useMemo(() => {
    const byAddr = new Map(
      state.subaccounts.map((s) => [s.address, s] as const),
    );
    return subRows
      .filter((r) => r.walletAddress && byAddr.has(r.walletAddress))
      .map((r) => ({
        address: r.walletAddress as string,
        displayName: r.displayName,
      }));
  }, [subRows, state.subaccounts]);

  const envelopeIndex = ENVELOPE_LABELS.indexOf(envelope);
  // Total includes the envelope's USDY position — the contract's
  // fund_subaccount auto-redeems from USDY via ensure_envelope_liquidity,
  // so the cache-only view understates spendable when Earn is enabled.
  const envelopeBalancePhp =
    (Number(envelopeTotalStroops(state, envelopeIndex)) / STROOPS_PER_USDC) *
    PHP_PER_USDC;

  const parsed = Number(amount);
  const validAmount = parsed > 0 && Number.isFinite(parsed);
  const stroopsRequested = validAmount
    ? BigInt(Math.round((parsed / PHP_PER_USDC) * STROOPS_PER_USDC))
    : 0n;
  const ok =
    validAmount && parsed <= envelopeBalancePhp && target !== null;

  // Multi-admin approval gate. Locked source envelope + 2+ admins
  // means the fund_subaccount call can't fire until every other admin
  // has approved. Solo-admin families skip approval — the sole
  // admin's own click IS the approval.
  const envelopeProtected =
    target !== null && state.policy.protectedEnvelopes.includes(envelope);
  const totalAdmins = state.admins.length;
  const needsApproval = envelopeProtected && totalAdmins > 1;
  const approval = useCashoutApproval({
    familyWalletId,
    memberWalletDbId,
    envelope,
    amountStroops: stroopsRequested,
    kind: "subaccount_fund",
    recipientAddress: target?.address ?? null,
  });
  const [phase, setPhase] = useState<"input" | "awaiting_approval">("input");

  const finishFund = async () => {
    if (!target || stroopsRequested <= 0n) return;
    try {
      await fund(envelope, target.address, stroopsRequested);
      onFlash(
        `Sent ₱${parsed.toLocaleString("en-PH", { minimumFractionDigits: 2 })} to ${target.displayName}`,
      );
      approval.reset();
      onSuccess();
    } catch {
      // surfaced via hook error state below
    }
  };

  // When the approval row flips to `approved`, fire fund_subaccount.
  // Solo-admin path never enters this branch — handleSend calls
  // finishFund directly.
  useEffect(() => {
    if (phase !== "awaiting_approval") return;
    if (approval.status === "approved") {
      void finishFund();
    } else if (approval.status === "denied") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("input");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, approval.status]);

  const handleSend = async () => {
    if (!ok || !target || stroopsRequested <= 0n) return;
    if (!needsApproval) {
      await finishFund();
      return;
    }
    setPhase("awaiting_approval");
    const id = await approval.create({ memo: "Sub-account fund" });
    if (!id) setPhase("input");
  };

  const handleCancelApproval = async () => {
    await approval.cancel();
    setPhase("input");
  };
  const approvalsRemaining = Math.max(
    0,
    totalAdmins - approval.approvers.length,
  );

  const title = initialTarget
    ? `Send to ${initialTarget.displayName}`
    : "Send to family member";

  if (phase === "awaiting_approval") {
    const envelopeLabel = displayEnvelopeName(envelope, state.envelope_names);
    return (
      <Sheet onClose={onClose} ariaLabel="Waiting for approval">
        <h2>Waiting for the other admin{totalAdmins > 2 ? "s" : ""}</h2>
        <p className="sub">
          {envelopeLabel} is a locked envelope. Every admin needs to approve
          before ₱{Math.round(parsed).toLocaleString("en-PH")} can move to{" "}
          {target?.displayName ?? "them"}.
        </p>
        <div
          className="rounded-[10px] px-4 py-4 mt-3 mb-4"
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="flex items-center gap-3 text-[13px]"
            style={{ color: "var(--text-1)", fontWeight: 600 }}
          >
            <Loader2 size={16} className="animate-spin" />
            {approval.approvers.length} of {totalAdmins} approved
            {approvalsRemaining > 0 ? (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-3)", fontWeight: 500 }}
              >
                · {approvalsRemaining} to go
              </span>
            ) : null}
          </div>
        </div>
        {approval.error ? (
          <p
            className="text-[12px] mb-3"
            style={{ color: "var(--sobre-danger)" }}
          >
            {approval.error}
          </p>
        ) : null}
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={() => void handleCancelApproval()}
          >
            Cancel request
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} ariaLabel={title}>
      <h2>{title}</h2>
      <p className="sub">
        Money leaves the envelope and lands in their spendable balance.
      </p>

      {!initialTarget ? (
        <div className="sobre-input-group">
          <label>Send to</label>
          {availableTargets.length === 0 ? (
            <div
              style={{
                padding: "12px",
                borderRadius: 10,
                border: "1px dashed var(--border)",
                fontSize: 12,
                color: "var(--text-3)",
              }}
            >
              No supplementary accounts yet. Add one from the Profile tab.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              {availableTargets.map((t) => {
                const active = target?.address === t.address;
                return (
                  <button
                    key={t.address}
                    type="button"
                    onClick={() => setTarget(t)}
                    disabled={pending}
                    className="flex items-center gap-3 p-3 rounded-[10px] text-left"
                    style={{
                      border: active
                        ? "1.5px solid var(--sobre-accent)"
                        : "1px solid var(--border)",
                      background: active
                        ? "var(--accent-soft)"
                        : "var(--surface-alt)",
                      cursor: pending ? "not-allowed" : "pointer",
                    }}
                  >
                    <Avatar src={null} name={t.displayName} size={32} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: active
                          ? "var(--sobre-accent)"
                          : "var(--text-1)",
                      }}
                    >
                      {t.displayName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {!initialEnvelope ? (
        <div className="sobre-input-group">
          <label>Envelope</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {ENVELOPE_LABELS.map((e, i) => {
              const bal =
                (Number(envelopeTotalStroops(state, i)) / STROOPS_PER_USDC) *
                PHP_PER_USDC;
              const active = envelope === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEnvelope(e)}
                  disabled={pending}
                  className="flex flex-col items-start gap-1 p-3 rounded-[10px] text-left"
                  style={{
                    border: active
                      ? "1.5px solid var(--sobre-accent)"
                      : "1px solid var(--border)",
                    background: active
                      ? "var(--accent-soft)"
                      : "var(--surface-alt)",
                    cursor: pending ? "not-allowed" : "pointer",
                    opacity: pending ? 0.6 : 1,
                  }}
                >
                  <div
                    className="text-[13px] font-medium"
                    style={{
                      color: active ? "var(--sobre-accent)" : "var(--text-1)",
                    }}
                  >
                    {displayEnvelopeName(e, state.envelope_names)}
                  </div>
                  <div
                    className="text-[11px] tabular"
                    style={{ color: "var(--text-3)" }}
                  >
                    ₱
                    {bal.toLocaleString("en-PH", {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="sobre-input-group">
        <label htmlFor="sub-fund-amount">Amount in pesos</label>
        <div className="sobre-input-wrap">
          <span className="prefix">₱</span>
          <input
            id="sub-fund-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="sobre-input has-prefix tabular"
            disabled={pending}
          />
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            marginTop: 6,
          }}
        >
          {displayEnvelopeName(envelope, state.envelope_names)} holds ₱
          {envelopeBalancePhp.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          .
        </div>
      </div>

      {error ? (
        <p
          className="text-xs break-all mb-3"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}

      <div className="sobre-modal-actions">
        <button
          type="button"
          className="sobre-btn sobre-btn-soft"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!ok || pending}
          className="sobre-btn sobre-btn-primary"
          style={{ opacity: !ok || pending ? 0.55 : 1 }}
        >
          {pending
            ? "Sending…"
            : `Send ₱${validAmount ? parsed.toLocaleString("en-PH") : "0"}`}
        </button>
      </div>
    </Sheet>
  );
}
