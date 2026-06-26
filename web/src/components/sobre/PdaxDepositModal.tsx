"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, ExternalLink, Loader2, Send } from "lucide-react";

import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { useDeposit } from "@/hooks/useDeposit";
import { usePdaxDeposit, type DepositStatus } from "@/hooks/usePdaxDeposit";
import { usePollStatus } from "@/hooks/usePollStatus";
import { useTokenRate } from "@/hooks/useTokenRate";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_TOKEN,
  displayEnvelopeName,
} from "@/lib/config";
import { backdropClose } from "@/lib/ui";

const QUICK_PHP = [100, 500, 1000, 5000];

/**
 * "Add money via PDAX" flow. Step machine driven by the `pdax_deposits`
 * row's status, surfaced via Supabase Realtime:
 *
 *   input    → user types PHP amount + taps Generate
 *   awaiting → checkout URL minted; user pays via InstaPay; we watch the
 *              row tick from pending → funded (PHP received by PDAX) →
 *              credited (the payment token — XLM today, USDC once PDAX UAT
 *              fixes its USDCXLM bucket — withdrawn to user's smart wallet)
 *   confirm  → the token has landed; user taps Confirm to fire the on-chain
 *              deposit() that splits across envelopes
 *   done     → split lands on chain; close modal, dashboard refreshes
 *   failed   → any step errored; show the reason + a Close
 */
type Phase =
  | "input"
  | "preparing"
  | "awaiting"
  | "confirm"
  | "splitting"
  | "done"
  | "failed";

/** Status-line copy for the AwaitingStep spinner. Hoisted so the record
 *  literal isn't allocated per-render. */
const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  pending: "Waiting for your GrabPay payment…",
  funded: "Payment in. Buying XLM through PDAX…",
  credited: "Funds landed in your wallet",
  split: "Done",
  failed: "Failed",
};

/** Title shown during the on-chain split step. Two sub-phases:
 *  - checking_balance: polling the SAC `balance()` until the relay's
 *    transfer to the smart wallet has propagated. Surfaces as a distinct
 *    title so the user knows we're waiting on the chain, not stuck.
 *  - depositing: the passkey prompt is up and we're submitting deposit(). */
const SPLIT_STEP_TITLE: Record<
  "idle" | "checking_balance" | "depositing",
  string
> = {
  idle: "Splitting across envelopes…",
  checking_balance: "Waiting for funds to settle…",
  depositing: "Splitting across envelopes…",
};

function phaseFromStatus(status: DepositStatus | undefined): Phase {
  switch (status) {
    case "pending":
    case "funded":
      return "awaiting";
    case "credited":
      return "confirm";
    case "split":
      return "done";
    case "failed":
      return "failed";
    default:
      return "awaiting";
  }
}

export function PdaxDepositModal({
  userAddress,
  state,
  contractId,
  onClose,
  onCancelMidFlight,
  onSuccess,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  /** Plain close — called for terminal-state closes (done / failed / never
   *  started) and after the user explicitly tapped a Close button. */
  onClose: () => void;
  /** Called when the user dismisses the modal while a row is mid-flight
   *  (preparing through credited). Parent surfaces a "cancelled, try again"
   *  toast. The polling effect tears down on unmount automatically. */
  onCancelMidFlight?: () => void;
  onSuccess: (info: { usdc: number; stroops: bigint }) => void;
}) {
  const [amountStr, setAmountStr] = useState("500");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const {
    initiate,
    row,
    markSplit,
    pending: pdaxPending,
    error: pdaxError,
  } = usePdaxDeposit(contractId);

  const {
    deposit,
    pending: depositPending,
    step: depositStep,
    error: depositError,
  } = useDeposit(userAddress, contractId);

  const [splitting, setSplitting] = useState(false);
  // "preparing" covers the gap between "user clicked Continue" and "PDAX
  // returned a checkout URL". The /fiat/deposit call takes 1-3s; without
  // this flag the modal stays on the input step with a frozen-looking
  // "Generating…" button, which reads as broken. With the flag we flip
  // to a centered-spinner step immediately and update copy as the URL
  // arrives.
  const [preparing, setPreparing] = useState(false);
  const { phpPerToken } = useTokenRate();

  // Modal mounts → focus the amount input so the user can type immediately.
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const amountPhp = Number(amountStr);
  const validAmount = Number.isFinite(amountPhp) && amountPhp > 0;
  const expectedToken = amountPhp / phpPerToken;

  const phase: Phase = preparing && !row
    ? "preparing"
    : !row
      ? "input"
      : splitting
        ? "splitting"
        : phaseFromStatus(row.status);

  // Wrap onClose: distinguish a terminal close ("Done" / "Close") from a
  // mid-flight dismiss (backdrop click while the row is still working).
  // The latter fires onCancelMidFlight so the parent can flash a toast.
  const handleClose = () => {
    const inFlight =
      phase === "preparing" ||
      phase === "awaiting" ||
      phase === "confirm" ||
      phase === "splitting";
    if (inFlight && onCancelMidFlight) onCancelMidFlight();
    onClose();
  };

  const error = pdaxError ?? depositError;

  const handleGenerate = async () => {
    if (!validAmount) return;
    setPreparing(true);
    try {
      const result = await initiate(amountPhp);
      // Best-effort auto-open. Some browsers block this (no user gesture
      // after an awaited call); the AwaitingStep always renders an
      // "Open checkout" anchor as the reliable fallback so the user
      // never gets stranded.
      window.open(result.paymentCheckoutUrl, "_blank", "noopener,noreferrer");
    } catch {
      setPreparing(false);
    }
  };

  const handleConfirmSplit = async () => {
    if (!row || row.amount_usdc === null) return;
    setSplitting(true);
    try {
      const stroops = BigInt(
        Math.round(row.amount_usdc * STROOPS_PER_TOKEN),
      );
      const txHash = await deposit(stroops);
      await markSplit(txHash);
      onSuccess({ usdc: row.amount_usdc, stroops });
    } catch {
      setSplitting(false);
    }
  };

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(handleClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        {/* key={phase} on the inner wrapper remounts the active phase on
            every transition. animate-in fade-in (tw-animate-css) then
            plays an entry animation so the user sees motion as the modal
            advances. duration-300 keeps it snappy. */}
        <div
          key={phase}
          className="animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
        {phase === "input" ? (
          <InputStep
            amountStr={amountStr}
            setAmountStr={setAmountStr}
            inputRef={inputRef}
            pending={pdaxPending}
            valid={validAmount}
            expectedToken={expectedToken}
            phpPerToken={phpPerToken}
            state={state}
            onCancel={handleClose}
            onGenerate={() => void handleGenerate()}
            error={error}
          />
        ) : null}

        {phase === "preparing" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title="Setting up your checkout…"
          />
        ) : null}

        {phase === "awaiting" && row ? (
          <AwaitingStep
            status={row.status}
            identifier={row.identifier}
            checkoutUrl={row.payment_checkout_url}
          />
        ) : null}

        {phase === "confirm" && row ? (
          <ConfirmStep
            amountToken={row.amount_usdc ?? expectedToken}
            phpPerToken={phpPerToken}
            state={state}
            pending={depositPending || pdaxPending}
            onConfirm={() => void handleConfirmSplit()}
            onCancel={handleClose}
            error={error}
          />
        ) : null}

        {phase === "splitting" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title={SPLIT_STEP_TITLE[depositStep]}
          />
        ) : null}

        {phase === "done" ? (
          <CenteredCopy
            icon={<Check size={28} strokeWidth={2.5} />}
            title="Money landed"
            footer={
              <button
                className="sobre-btn sobre-btn-primary"
                onClick={onClose}
                style={{ padding: "12px 20px" }}
              >
                Done
              </button>
            }
          />
        ) : null}

        {phase === "failed" && row ? (
          <CenteredCopy
            icon={<Clock size={28} strokeWidth={2} />}
            title="Something went wrong"
            footer={
              <button
                className="sobre-btn sobre-btn-soft"
                onClick={onClose}
                style={{ padding: "12px 20px" }}
              >
                Close
              </button>
            }
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}

function InputStep({
  amountStr,
  setAmountStr,
  inputRef,
  pending,
  valid,
  expectedToken,
  phpPerToken,
  state,
  onCancel,
  onGenerate,
  error,
}: {
  amountStr: string;
  setAmountStr: (s: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  pending: boolean;
  valid: boolean;
  expectedToken: number;
  phpPerToken: number;
  state: WalletState;
  onCancel: () => void;
  onGenerate: () => void;
  error: string | null;
}) {
  return (
    <>
      <h2>Add money via PDAX</h2>
      <p className="sub">
        Pay in pesos via InstaPay (any bank or e-wallet). PDAX credits your
        Sobre wallet automatically. The contract splits across envelopes when
        you confirm.
      </p>

      <div className="sobre-input-group">
        <label htmlFor="pdax-amount">Amount in pesos</label>
        <div className="sobre-input-wrap">
          <span className="prefix">₱</span>
          <input
            id="pdax-amount"
            ref={inputRef}
            className="sobre-input has-prefix tabular"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="sobre-quick-amts">
          {QUICK_PHP.map((q) => (
            <button
              key={q}
              type="button"
              className={amountStr === String(q) ? "active" : ""}
              onClick={() => setAmountStr(String(q))}
              disabled={pending}
            >
              ₱{q.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {valid ? (
        <SplitPreview
          title="Auto-split preview"
          amountToken={expectedToken}
          phpPerToken={phpPerToken}
          state={state}
        />
      ) : null}

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
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={onGenerate}
          disabled={!valid || pending}
          style={!valid || pending ? { opacity: 0.5 } : {}}
        >
          <Send size={14} strokeWidth={2.2} />
          {pending ? "Generating…" : "Continue to PDAX"}
        </button>
      </div>
    </>
  );
}

function AwaitingStep({
  status,
  identifier,
  checkoutUrl,
}: {
  status: DepositStatus;
  identifier: string;
  /** Surfaces as a manual "Open checkout" anchor under the spinner so the
   *  user always has a reliable way back to GrabPay if the auto-open got
   *  blocked or the tab was closed. */
  checkoutUrl: string | null;
}) {
  // Drive PDAX's pipeline. Each tick on poll-status advances one state-machine
  // step; Realtime surfaces the resulting row updates to the modal. Cleanup
  // on unmount in usePollStatus stops the loop when the modal closes.
  const polling =
    status !== "credited" && status !== "split" && status !== "failed";
  usePollStatus(
    polling ? `/api/pdax/deposits/${identifier}/poll-status` : null,
    polling,
  );

  return (
    <CenteredCopy
      icon={<Loader2 size={28} className="animate-spin" />}
      title={DEPOSIT_STATUS_LABELS[status]}
      footer={
        status === "pending" && checkoutUrl ? (
          <a
            className="sobre-btn sobre-btn-soft"
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "10px 16px", fontSize: 13 }}
          >
            <ExternalLink size={14} strokeWidth={2.2} />
            Open checkout
          </a>
        ) : undefined
      }
    />
  );
}

function ConfirmStep({
  amountToken,
  phpPerToken,
  state,
  pending,
  onConfirm,
  onCancel,
  error,
}: {
  amountToken: number;
  phpPerToken: number;
  state: WalletState;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  const amountPhp = amountToken * phpPerToken;
  return (
    <>
      <h2>Funds arrived</h2>
      <p className="sub">
        ₱{amountPhp.toLocaleString("en-PH", { minimumFractionDigits: 2 })} is
        in your wallet. Confirm to split it across envelopes.
      </p>

      <SplitPreview
        title="Split preview"
        amountToken={amountToken}
        phpPerToken={phpPerToken}
        state={state}
      />

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
          onClick={onCancel}
          disabled={pending}
        >
          Not now
        </button>
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={onConfirm}
          disabled={pending}
          style={pending ? { opacity: 0.5 } : {}}
        >
          {pending ? "Splitting…" : "Confirm split"}
        </button>
      </div>
    </>
  );
}

function SplitPreview({
  title,
  amountToken,
  phpPerToken,
  state,
}: {
  title: string;
  amountToken: number;
  phpPerToken: number;
  state: WalletState;
}) {
  return (
    <div
      className="rounded-[10px] p-[14px_16px] mb-[18px]"
      style={{ background: "var(--surface-alt)" }}
    >
      <div className="sobre-label mb-2.5">{title}</div>
      {ENVELOPE_LABELS.map((env, i) => {
        const portionPhp = ((amountToken * state.percents[i]) / 100) * phpPerToken;
        const label = displayEnvelopeName(env, state.envelope_names);
        return (
          <div
            key={env}
            className="flex justify-between items-center py-1.5 text-[14px]"
          >
            <span style={{ color: "var(--text-1)" }}>
              {label}{" "}
              <span style={{ color: "var(--text-3)" }}>
                · {state.percents[i]}%
              </span>
            </span>
            <span
              className="tabular font-semibold"
              style={{
                color:
                  env === "Savings"
                    ? "var(--sobre-accent)"
                    : "var(--text-1)",
              }}
            >
              + ₱
              {portionPhp.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
