"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  GraduationCap,
  ShoppingCart,
  Sprout,
} from "lucide-react";

import { useCreatePendingRequest } from "@/hooks/useCreatePendingRequest";
import { useSpend } from "@/hooks/useSpend";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PAYMENT_TOKEN_LABEL,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { formatPhpInt, formatPhpLocale } from "@/lib/format";
import { routeSpend } from "@/lib/policy";
import { backdropClose } from "@/lib/ui";
import { PHP_PER_USDC } from "@/lib/config";

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
  familyWalletId,
  envelope,
  dailySpent,
  onClose,
  onSuccess,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  /** Required when willGoPending is true (we stage a Supabase request).
   *  Null is OK if the spend never routes pending. */
  familyWalletId: string | null;
  envelope: EnvelopeName;
  /** Stroops the caller has already spent today. */
  dailySpent: bigint;
  onClose: () => void;
  /** `willGoPending` true means the spend was staged for admin approval
   *  (Supabase write only, no chain call). false means the spend executed
   *  on chain and tokens are in the caller's wallet. */
  onSuccess: (info: {
    willGoPending: boolean;
    amount: bigint;
    envelope: EnvelopeName;
  }) => void;
}) {
  const idx = ENVELOPE_LABELS.indexOf(envelope);
  const displayName = displayEnvelopeName(envelope, state.envelope_names);
  const balanceStroops = state.balances[idx] ?? 0n;
  const balanceUsdc = Number(balanceStroops) / STROOPS_PER_USDC;
  const balancePhp = balanceUsdc * PHP_PER_USDC;

  const [phpStr, setPhpStr] = useState("");
  const [memo, setMemo] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const memberWalletDbId =
    state.members.find((m) => m.address === userAddress)?.walletDbId ?? null;

  const { spend, pending: spendPending, error: spendError } = useSpend(
    userAddress,
    contractId,
  );
  const {
    create: createPending,
    pending: pendingPending,
    error: pendingError,
  } = useCreatePendingRequest(userAddress, memberWalletDbId);
  const pending = spendPending || pendingPending;
  const error = spendError ?? pendingError;

  const php = Number(phpStr) || 0;
  const usdc = php / PHP_PER_USDC;
  const stroopsRequested = BigInt(Math.round(usdc * STROOPS_PER_USDC));

  // Canonical "where does this spend land" verdict lives in lib/policy.ts
  // so envelope card previews + future surfaces share the spec.
  const route = routeSpend({
    policy: state.policy,
    caller: userAddress,
    admin: state.admin,
    envelope,
    amountStroops: stroopsRequested,
    dailySpentStroops: dailySpent,
    envelopeBalanceStroops: balanceStroops,
  });
  const overspend = route === "overspend";
  const willGoPending = route === "pending";
  // Surfaced in the warning bar so the user can see WHICH gate routed
  // their spend. routeSpend collapses these into one verdict; we still
  // pull the underlying fields to compose human-readable copy.
  const requireAllSigs = state.policy.requireAllSigs;
  const envProtected = state.policy.protectedEnvelopes.includes(envelope);
  const dailyLimitStroops = state.policy.dailyLimit;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async () => {
    if (php <= 0 || overspend) return;
    try {
      if (willGoPending) {
        if (!familyWalletId) {
          throw new Error("Family record not loaded yet. Try again.");
        }
        await createPending({
          familyWalletId,
          envelope,
          amountStroops: stroopsRequested,
          memo,
        });
      } else {
        await spend(envelope, stroopsRequested, memo);
      }
      onSuccess({
        willGoPending: Boolean(willGoPending),
        amount: stroopsRequested,
        envelope,
      });
    } catch {
      // error already surfaced via hook
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
          · <span className="tabular">{balanceUsdc.toFixed(4)} {PAYMENT_TOKEN_LABEL}</span>
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
                  : `Spending ${formatPhpInt(stroopsRequested)} would put you over today's ${formatPhpInt(dailyLimitStroops)} limit (already spent ${formatPhpLocale(dailySpent)} today), so this spend needs admin approval.`}{" "}
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
                      ? `Not enough. ₱${balancePhp.toFixed(0)} available`
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
              ≈ {usdc.toFixed(4)} {PAYMENT_TOKEN_LABEL}
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
