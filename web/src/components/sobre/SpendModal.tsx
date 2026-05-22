"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  GraduationCap,
  ShoppingCart,
  Sprout,
} from "lucide-react";

import { useSpend } from "@/hooks/useSpend";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_XLM,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { backdropClose } from "@/lib/ui";
import { usePhpPerXlm } from "@/lib/usePhpPerXlm";

const QUICK_PHP = [50, 100, 500, 1000];

const ICONS: Record<EnvelopeName, React.ReactNode> = {
  Groceries: <ShoppingCart size={20} strokeWidth={2} />,
  Tuition: <GraduationCap size={20} strokeWidth={2} />,
  Savings: <Sprout size={20} strokeWidth={2} />,
};

export function SpendModal({
  userAddress,
  state,
  contractId,
  envelope,
  dailySpent,
  onClose,
  onSuccess,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  envelope: EnvelopeName;
  /** Stroops the caller has already spent today. Used to predict daily-limit
   *  routing the same way the contract does (daily_spent + amount > limit). */
  dailySpent: bigint;
  onClose: () => void;
  /** Called after the tx lands. `willGoPending` is the modal's prediction of
   *  whether the contract routed the spend to a pending request (vs executed
   *  immediately) — computed from the same policy_requires_approval rules. */
  onSuccess: (info: {
    willGoPending: boolean;
    amount: bigint;
    envelope: EnvelopeName;
  }) => void;
}) {
  const PHP_PER_XLM = usePhpPerXlm();
  const idx = ENVELOPE_LABELS.indexOf(envelope);
  const displayName = displayEnvelopeName(envelope, state.envelope_names);
  const balanceStroops = state.balances[idx] ?? 0n;
  const balanceXlm = Number(balanceStroops) / STROOPS_PER_XLM;
  const balancePhp = balanceXlm * PHP_PER_XLM;

  const [phpStr, setPhpStr] = useState("");
  const [memo, setMemo] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { spend, pending, error } = useSpend(userAddress, contractId);

  const php = Number(phpStr) || 0;
  const xlm = php / PHP_PER_XLM;
  const stroopsRequested = BigInt(Math.round(xlm * STROOPS_PER_XLM));
  const overspend = stroopsRequested > balanceStroops;

  // Predict whether the contract will route this to a pending request,
  // matching policy_requires_approval in lib.rs. Admin always bypasses, so
  // their spends execute immediately regardless of policy.
  const isAdmin = userAddress === state.admin;
  const requireAllSigs = state.policy.require_all_sigs;
  const envProtected = state.policy.protected_envelopes.includes(envelope);
  const dailyLimitStroops = state.policy.daily_limit;
  const wouldExceedDaily =
    dailyLimitStroops !== null &&
    dailySpent + stroopsRequested > dailyLimitStroops;
  const willGoPending =
    !isAdmin &&
    php > 0 &&
    !overspend &&
    (requireAllSigs || envProtected || wouldExceedDaily);

  const dailyLimitPhp =
    dailyLimitStroops !== null
      ? (Number(dailyLimitStroops) / STROOPS_PER_XLM) * PHP_PER_XLM
      : 0;
  const dailySpentPhp =
    (Number(dailySpent) / STROOPS_PER_XLM) * PHP_PER_XLM;
  const fmtPhpAmt = (n: number) =>
    `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async () => {
    if (php <= 0 || overspend) return;
    try {
      await spend(envelope, stroopsRequested, memo);
      onSuccess({
        willGoPending: Boolean(willGoPending),
        amount: stroopsRequested,
        envelope,
      });
    } catch {
      // error already on hook
    }
  };

  const isSavings = envelope === "Savings";

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-1.5">
          <div
            className="grid place-items-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: isSavings
                ? "var(--accent-soft)"
                : "var(--surface-alt)",
              color: isSavings ? "var(--sobre-accent)" : "var(--text-1)",
            }}
          >
            {ICONS[envelope]}
          </div>
          <h2 style={{ margin: 0 }}>Spend from {displayName}</h2>
        </div>
        <p className="sub">
          Available:{" "}
          <b className="tabular" style={{ color: "var(--text-1)" }}>
            ₱{" "}
            {balancePhp.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </b>{" "}
          · <span className="tabular">{balanceXlm.toFixed(4)} XLM</span>
        </p>

        {willGoPending ? (
          <div className="sobre-warning-bar">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <div>
              <b>This will create a withdrawal request, not a direct spend.</b>{" "}
              {requireAllSigs
                ? "All non-admin spends need admin approval right now."
                : envProtected
                  ? `${displayName} is admin-protected.`
                  : `Spending ${fmtPhpAmt(php)} would put you over today's ${fmtPhpAmt(dailyLimitPhp)} limit (already spent ${fmtPhpAmt(dailySpentPhp)} today), so this spend needs admin approval.`}{" "}
              Admin reviews the request before the funds move.
            </div>
          </div>
        ) : null}

        {overspend && php > 0 ? (
          <div
            className="sobre-warning-bar"
            style={{
              background: "#fbe4e0",
              borderColor: "#e8b9b0",
              color: "#7a2a1d",
            }}
          >
            <AlertTriangle size={16} strokeWidth={2.2} />
            <div>
              <b>Not enough in this envelope.</b> Balance is ₱{" "}
              {balancePhp.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
              })}
              .
            </div>
          </div>
        ) : null}

        <div className="sobre-input-group">
          <label htmlFor="spend-amount">Amount</label>
          <div className="sobre-input-wrap">
            <span className="prefix">₱</span>
            <input
              id="spend-amount"
              ref={inputRef}
              className="sobre-input has-prefix tabular"
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              min="0"
              step="0.01"
              value={phpStr}
              onChange={(e) => setPhpStr(e.target.value)}
              disabled={pending}
            />
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(balancePhp))}
            step={Math.max(1, Math.round(balancePhp / 100))}
            value={Math.min(php, balancePhp)}
            onChange={(e) => setPhpStr(e.target.value)}
            disabled={pending || balancePhp === 0}
            className="sobre-slider mt-3"
            aria-label="Amount slider"
          />
          <div
            className="flex justify-between text-[11px] mt-1 tabular"
            style={{ color: "var(--text-3)" }}
          >
            <span>₱0</span>
            <span>
              ₱
              {balancePhp.toLocaleString("en-PH", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
            </span>
          </div>

          <div className="sobre-quick-amts">
            {QUICK_PHP.map((q) => {
              const disabled = pending || q > balancePhp;
              return (
                <button
                  key={q}
                  type="button"
                  className={phpStr === String(q) ? "active" : ""}
                  onClick={() => setPhpStr(String(q))}
                  disabled={disabled}
                  style={
                    disabled
                      ? {
                          opacity: 0.4,
                          cursor: "not-allowed",
                          textDecoration:
                            q > balancePhp ? "line-through" : undefined,
                        }
                      : undefined
                  }
                  title={
                    q > balancePhp
                      ? `Not enough — ₱${balancePhp.toFixed(0)} available`
                      : undefined
                  }
                >
                  ₱{q.toLocaleString()}
                </button>
              );
            })}
          </div>
          {php > 0 ? (
            <div
              className="mt-2 text-[12px]"
              style={{ color: "var(--text-3)" }}
            >
              ≈ {xlm.toFixed(4)} XLM
            </div>
          ) : null}
        </div>

        <div className="sobre-input-group">
          <label htmlFor="spend-memo">
            What&apos;s it for?{" "}
            <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <input
            id="spend-memo"
            className="sobre-input"
            type="text"
            placeholder="groceries, gas, tuition…"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            disabled={pending}
            maxLength={120}
          />
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
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="sobre-btn sobre-btn-primary"
            onClick={() => void handleSubmit()}
            disabled={!php || overspend || pending}
            style={
              !php || overspend || pending
                ? { opacity: 0.5, cursor: "not-allowed" }
                : {}
            }
          >
            {pending
              ? "Submitting…"
              : willGoPending
                ? "Request withdrawal"
                : "Confirm spend"}
          </button>
        </div>
      </div>
    </div>
  );
}
