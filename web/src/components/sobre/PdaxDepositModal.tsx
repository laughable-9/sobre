"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  | "celebrating"
  | "confirm"
  | "splitting"
  | "done"
  | "failed";

/** Rotating headlines per row status. The AwaitingStep cycles through
 *  these on a 3.5s interval so the spinner feels alive while we wait on
 *  PDAX. First entry is the on-arrival message; later entries are
 *  reassurance variants. */
/** Every title sits on one line so the modal height doesn't bob as the
 *  rotation cycles. Keep new entries under ~28 characters. */
const PENDING_MESSAGES = [
  "Waiting for payment…",
  "Almost there…",
  "Still listening…",
];

const FUNDED_MESSAGES = [
  "Buying XLM…",
  "Locking in the rate…",
  "Sending to your wallet…",
];

function rotatingTitlesFor(status: DepositStatus): string[] {
  switch (status) {
    case "pending":
      return PENDING_MESSAGES;
    case "funded":
      return FUNDED_MESSAGES;
    case "credited":
      return ["Funds landed"];
    case "split":
      return ["Done"];
    case "failed":
      return ["Failed"];
  }
}

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
  resumeIdentifier,
  onActiveIdentifierChange,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  /** Plain close. Called for terminal-state closes (done / failed / never
   *  started) and after the user explicitly tapped a Close button. */
  onClose: () => void;
  /** Called when the user dismisses the modal while a row is mid-flight
   *  (preparing through credited). Parent surfaces a "cancelled, try again"
   *  toast. The polling effect tears down on unmount automatically. */
  onCancelMidFlight?: () => void;
  onSuccess: (info: { usdc: number; stroops: bigint }) => void;
  /** When set, the modal hydrates state from this existing deposit row
   *  and skips the input/preparing steps. The user lands on whichever
   *  phase matches the row's current status (typically `awaiting` or
   *  `confirm`). Drives the activity-feed "Resume" affordance. */
  resumeIdentifier?: string;
  /** Fires whenever the modal acquires (or releases) a row identifier.
   *  The parent uses it to filter the currently-handled row out of the
   *  PENDING bucket in the activity feed so the same deposit doesn't
   *  show up in two places at once. */
  onActiveIdentifierChange?: (identifier: string | null) => void;
}) {
  const [amountStr, setAmountStr] = useState("500");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const {
    initiate,
    row,
    markSplit,
    pending: pdaxPending,
    error: pdaxError,
  } = usePdaxDeposit(contractId, resumeIdentifier);

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
  // Brief celebration overlay when the row transitions to a new milestone
  // (pending → funded shows "Payment confirmed!", funded → credited shows
  // "Funds arrived!"). Adds a beat of feedback between the long loading
  // phases instead of letting the spinner swap silently. Cleared by a
  // setTimeout below.
  const [celebration, setCelebration] = useState<
    "payment_confirmed" | "funds_arrived" | null
  >(null);
  const lastStatusRef = useRef<DepositStatus | null>(null);
  const { phpPerToken } = useTokenRate();

  // Surface the active identifier to the parent. Null on mount (and
  // again on unmount) so the dashboard can hide the row from PENDING
  // while it's being handled here, then re-surface it the moment the
  // modal closes mid-flight.
  useEffect(() => {
    onActiveIdentifierChange?.(row?.identifier ?? null);
    return () => onActiveIdentifierChange?.(null);
  }, [row?.identifier, onActiveIdentifierChange]);

  // Watch for status transitions to fire celebrations.
  useEffect(() => {
    const current = row?.status;
    if (!current) return;
    const last = lastStatusRef.current;
    lastStatusRef.current = current;
    if (last === "pending" && current === "funded") {
      setCelebration("payment_confirmed");
      const t = setTimeout(() => setCelebration(null), 1500);
      return () => clearTimeout(t);
    }
    if (last === "funded" && current === "credited") {
      setCelebration("funds_arrived");
      const t = setTimeout(() => setCelebration(null), 1500);
      return () => clearTimeout(t);
    }
  }, [row?.status]);

  // Modal mounts → focus the amount input so the user can type immediately.
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const amountPhp = Number(amountStr);
  const validAmount = Number.isFinite(amountPhp) && amountPhp > 0;
  const expectedToken = amountPhp / phpPerToken;

  // When the modal opens via "Resume", row is null for one paint while the
  // hydration fetch is in flight. Showing InputStep in that gap reads as
  // a glitch (the form flashes for a moment before the spinner). Force
  // the preparing phase whenever a resume hydration is pending so the
  // user only ever sees the spinner.
  const hydrating = !row && Boolean(resumeIdentifier);
  const phase: Phase = (preparing || hydrating) && !row
    ? "preparing"
    : !row
      ? "input"
      : celebration
        ? "celebrating"
        : splitting
          ? "splitting"
          : phaseFromStatus(row.status);

  // Wrap onClose with safety rails:
  // - LOCKED states (modal refuses to close): celebrating, splitting,
  //   confirm, and awaiting once status is past pending. Closing while
  //   money is at PDAX or sitting in the smart wallet would strand
  //   funds where the user can't easily recover them mid-demo.
  // - CANCELLABLE in-flight states: preparing + awaiting/pending. PDAX
  //   may have a half-started checkout but no money has moved yet, so
  //   a cancel toast is honest signal. If the user had already paid
  //   GrabPay, the row sits at pending until polling re-detects it
  //   (modal would have to be re-opened from Activity, follow-up work).
  // - Terminal states (done/failed) and pre-start (input): plain close.
  const handleClose = () => {
    const locked =
      phase === "celebrating" ||
      phase === "splitting" ||
      phase === "confirm" ||
      (phase === "awaiting" && row?.status !== "pending");
    if (locked) return;

    const inFlight = phase === "preparing" || phase === "awaiting";
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

        {phase === "celebrating" ? (
          <CenteredCopy
            icon={<Check size={28} strokeWidth={2.5} />}
            title={
              celebration === "payment_confirmed"
                ? "Payment confirmed!"
                : "Funds arrived!"
            }
          />
        ) : null}

        {phase === "confirm" && row ? (
          <ConfirmStep
            amountToken={row.amount_usdc ?? expectedToken}
            phpPerToken={phpPerToken}
            state={state}
            pending={depositPending || pdaxPending}
            onConfirm={() => void handleConfirmSplit()}
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

  // Rotate through the per-status titles so the spinner doesn't feel
  // frozen during the multi-second waits. 3.5s cadence — long enough to
  // read, short enough to feel like progress. Reset to the first entry
  // whenever the status changes so the user sees the "headline" message
  // first as each new step begins.
  const titles = useMemo(() => rotatingTitlesFor(status), [status]);
  const [titleIdx, setTitleIdx] = useState(0);
  useEffect(() => {
    setTitleIdx(0);
  }, [status]);
  useEffect(() => {
    if (titles.length <= 1) return;
    const t = setInterval(
      () => setTitleIdx((i) => (i + 1) % titles.length),
      3500,
    );
    return () => clearInterval(t);
  }, [titles]);

  return (
    <CenteredCopy
      icon={<Loader2 size={28} className="animate-spin" />}
      title={titles[titleIdx]}
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
  error,
}: {
  amountToken: number;
  phpPerToken: number;
  state: WalletState;
  pending: boolean;
  onConfirm: () => void;
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

      <div
        className="sobre-modal-actions"
        style={{ justifyContent: "center" }}
      >
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
