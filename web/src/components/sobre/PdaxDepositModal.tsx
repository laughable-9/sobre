"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, ExternalLink, Loader2, Send } from "lucide-react";

import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { Sheet } from "@/components/sobre/Sheet";
import { usePdaxDeposit, type DepositStatus } from "@/hooks/usePdaxDeposit";
import { usePollStatus } from "@/hooks/usePollStatus";
import { useTokenRate } from "@/hooks/useTokenRate";
import type { WalletState } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS, displayEnvelopeName } from "@/lib/config";

// First pill is the PDAX cash-in minimum (₱200). Anything below is rejected
// at the /trade/quote step — don't surface it as a one-tap option.
const QUICK_PHP = [200, 500, 1000, 5000];

/** InstaPay per-transaction ceiling. Deposits use `instapay_upay_cashin`
 *  which inherits the BSP-mandated ₱50k real-time InstaPay cap. Above
 *  ₱50k also triggers PDAX's Travel Rule fields (sender ID or address
 *  or DOB + place of birth) which we don't collect today — capping at
 *  the tier boundary lets the flow stay identity-light. */
const PDAX_DEPOSIT_MIN_PHP = 200;
const PDAX_DEPOSIT_MAX_PHP = 49_999;

/**
 * "Add money via PDAX" flow. Step machine driven by the `pdax_deposits`
 * row's status, surfaced via Supabase Realtime:
 *
 *   input    → user types PHP amount + taps Generate
 *   awaiting → checkout URL minted; user pays via InstaPay; we watch the
 *              row tick from pending → funded (PHP received by PDAX) →
 *              credited (contract's `deposit_from_xlm` swapped USDC and
 *              credited envelopes atomically)
 *   done     → server credited envelopes; close modal, dashboard refreshes
 *   failed   → any step errored; show the reason + a Close
 */
type Phase =
  | "input"
  | "preparing"
  | "awaiting"
  | "celebrating"
  | "done"
  | "failed"
  | "cancelling";

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

function phaseFromStatus(status: DepositStatus | undefined): Phase {
  switch (status) {
    case "pending":
    case "funded":
      return "awaiting";
    case "credited":
    case "split":
      // 2026-07-12 pivot: server-side `deposit_from_xlm` credits envelopes
      // directly, so `credited` is already the terminal successful state.
      // `split` maps here too for pre-pivot rows that used the old two-step
      // flow (credited → user signs deposit_with_split → split).
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
  onAttemptCancel,
  onSuccess,
  resumeIdentifier,
  onActiveIdentifierChange,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  /** Plain close. Called for terminal-state closes (done / failed / never
   *  started) and once an in-flight cancel has resolved. The modal never
   *  closes itself behind onAttemptCancel's back. */
  onClose: () => void;
  /** Resolves when the parent has finished its server-side cancel +
   *  flash + activity-feed refresh. Returning `alreadyPaid: true`
   *  keeps the modal OPEN so the user sees their deposit continue
   *  through buying/credited rather than landing on a confusing
   *  pending-but-paid row in the activity feed. The identifier is null
   *  when the user closed before /fiat/deposit returned — there's
   *  nothing to cancel server-side in that case. */
  onAttemptCancel?: (
    identifier: string | null,
  ) => Promise<{ ok: boolean; alreadyPaid?: boolean }>;
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
    pending: pdaxPending,
    error: pdaxError,
  } = usePdaxDeposit(contractId, resumeIdentifier);
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
  // Cancel state lifted to the modal so the inline "Cancel this checkout"
  // button and the backdrop-close path share one source of truth (and
  // never split into two competing /cancel calls). `alreadyPaidNotice`
  // is set when /cancel returns 409 — the modal STAYS OPEN at that
  // point so the user sees their already-paid deposit continue through
  // buying → credited, rather than landing on a confusing
  // pending-but-paid row in the activity feed.
  // `cancelling` doubles as the deferred-cancel flag: when set with no
  // row yet, the effect below holds the modal at the "Cancelling…"
  // spinner and fires /cancel the moment /fiat/deposit returns. Without
  // that the row would be born orphaned at status=pending after the
  // modal had already closed.
  const [cancelling, setCancelling] = useState(false);
  const [alreadyPaidNotice, setAlreadyPaidNotice] = useState(false);
  // Guard against the deferred-cancel effect firing /cancel twice when
  // the parent re-renders mid-await (onAttemptCancel / onClose are
  // inline arrows in the dashboard, so their identity changes on every
  // render). Setting the ref before kicking the IIFE makes the second
  // run a no-op.
  const cancelFiredRef = useRef(false);
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
  const belowMin =
    Number.isFinite(amountPhp) && amountPhp > 0 && amountPhp < PDAX_DEPOSIT_MIN_PHP;
  const aboveMax =
    Number.isFinite(amountPhp) && amountPhp > PDAX_DEPOSIT_MAX_PHP;
  const validAmount =
    Number.isFinite(amountPhp) &&
    amountPhp >= PDAX_DEPOSIT_MIN_PHP &&
    amountPhp <= PDAX_DEPOSIT_MAX_PHP;
  const expectedToken = amountPhp / phpPerToken;

  // When the modal opens via "Resume", row is null for one paint while the
  // hydration fetch is in flight. Showing InputStep in that gap reads as
  // a glitch (the form flashes for a moment before the spinner). Force
  // the preparing phase whenever a resume hydration is pending so the
  // user only ever sees the spinner.
  const hydrating = !row && Boolean(resumeIdentifier);
  // While the user-initiated cancel is in flight, the row may flip to
  // `failed` via Supabase Realtime BEFORE the parent's onAttemptCancel
  // promise resolves and triggers onClose. Without this override the
  // failed phase ("Something went wrong") flashes for a beat between
  // the Realtime push and the modal closing. Showing a "Cancelling…"
  // spinner instead keeps the close feeling intentional.
  let phase: Phase;
  if (cancelling) phase = "cancelling";
  else if ((preparing || hydrating) && !row) phase = "preparing";
  else if (!row) phase = "input";
  else if (celebration) phase = "celebrating";
  else phase = phaseFromStatus(row.status);

  // Phases where a backdrop click, drag, or programmatic close must NOT
  // dismiss the modal — payment is either mid-processing (`awaiting`
  // after status leaves `pending`, `cancelling`) or in a brief animation
  // the user shouldn't interrupt (`celebrating`). Sheet's `canClose`
  // gate ignores backdrop clicks during these phases; attemptCancel
  // early-returns for the same reason.
  const lockedPhase =
    phase === "celebrating" ||
    phase === "cancelling" ||
    (phase === "awaiting" && row?.status !== "pending");

  // One close path for the inline "Cancel this checkout" button AND the
  // backdrop/escape close. Safety rails:
  // - LOCKED (refuses to close): see `lockedPhase` above.
  // - Terminal / pre-start (input, done, failed): plain close, no
  //   cancel call needed.
  // - After 409 (alreadyPaidNotice set): plain close too — we already
  //   determined PDAX has the money on a prior cancel attempt, so don't
  //   ping /cancel again, and don't try to talk the user out of
  //   leaving.
  // - In-flight cancellable (preparing, awaiting+pending): delegate
  //   to onAttemptCancel. If parent reports `alreadyPaid: true`, we
  //   KEEP THE MODAL OPEN and let poll-status drive the row through
  //   funded → credited. Otherwise we close after the parent's cancel
  //   + refresh resolves.
  const attemptCancel = async () => {
    if (lockedPhase) return;

    const cleanClose =
      phase === "input" ||
      phase === "done" ||
      phase === "failed" ||
      alreadyPaidNotice;
    if (cleanClose) {
      onClose();
      return;
    }

    if (cancelling) return;
    setCancelling(true);

    // No row yet because /fiat/deposit hasn't returned. The effect
    // below holds the modal at "Cancelling…" and fires /cancel the
    // moment the row appears — otherwise the row would be born
    // orphaned at status=pending after the modal had already closed.
    if (!row?.identifier) return;

    cancelFiredRef.current = true;
    try {
      const result = (await onAttemptCancel?.(row.identifier)) ?? { ok: true };
      if (result.alreadyPaid) {
        // PDAX has the payment. The parent has already flashed the
        // reassuring toast and kicked /poll-status server-side. Keep
        // the modal open so the user watches the deposit advance
        // instead of seeing it land in the activity feed as
        // "Awaiting payment" — which reads as if their tap did
        // nothing.
        setAlreadyPaidNotice(true);
        cancelFiredRef.current = false;
        setCancelling(false);
        return;
      }
      onClose();
    } finally {
      if (!alreadyPaidNotice) {
        cancelFiredRef.current = false;
        setCancelling(false);
      }
    }
  };

  // Deferred-cancel driver for the "user closed during preparing"
  // path. Fires when:
  //  - the row finally arrives → fire /cancel on it, then close.
  //  - /fiat/deposit failed (preparing flipped off without a row) →
  //    nothing to cancel server-side, just close.
  // The ref guard prevents a double-POST when the parent re-renders
  // mid-await (onAttemptCancel/onClose are inline arrows in the
  // dashboard, so their identity changes per render).
  useEffect(() => {
    if (!cancelling) return;
    if (cancelFiredRef.current) return;
    if (row?.identifier) {
      cancelFiredRef.current = true;
      void (async () => {
        try {
          await onAttemptCancel?.(row.identifier);
        } finally {
          cancelFiredRef.current = false;
          setCancelling(false);
          onClose();
        }
      })();
      return;
    }
    if (!preparing) {
      setCancelling(false);
      onClose();
    }
  }, [cancelling, row?.identifier, preparing, onAttemptCancel, onClose]);

  const error = pdaxError;

  const handleGenerate = async () => {
    if (!validAmount) return;
    // Don't auto-open a popup — a slow or failing `initiate` leaves the
    // popup stuck at about:blank, which reads as broken. The AwaitingStep
    // renders a normal anchor the user taps once the URL is ready; the
    // click there is in the same gesture chain so no popup blocker fires.
    setPreparing(true);
    try {
      await initiate(amountPhp);
    } catch {
      setPreparing(false);
    }
  };

  return (
    <Sheet
      onClose={() => void attemptCancel()}
      canClose={!lockedPhase}
      ariaLabel="Add money"
    >
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
            belowMin={belowMin}
            aboveMax={aboveMax}
            expectedToken={expectedToken}
            phpPerToken={phpPerToken}
            state={state}
            onCancel={() => void attemptCancel()}
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

        {phase === "cancelling" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title="Cancelling…"
          />
        ) : null}

        {phase === "awaiting" && row ? (
          <AwaitingStep
            status={row.status}
            identifier={row.identifier}
            checkoutUrl={row.payment_checkout_url}
            cancelling={cancelling}
            alreadyPaidNotice={alreadyPaidNotice}
            onCancel={() => void attemptCancel()}
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
    </Sheet>
  );
}

function InputStep({
  amountStr,
  setAmountStr,
  inputRef,
  pending,
  valid,
  belowMin,
  aboveMax,
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
  belowMin: boolean;
  aboveMax: boolean;
  expectedToken: number;
  phpPerToken: number;
  state: WalletState;
  onCancel: () => void;
  onGenerate: () => void;
  error: string | null;
}) {
  const rangeHint = `Between ₱${PDAX_DEPOSIT_MIN_PHP.toLocaleString("en-PH")} and ₱${PDAX_DEPOSIT_MAX_PHP.toLocaleString("en-PH")} per deposit.`;
  const validationMsg = belowMin
    ? `PDAX minimum is ₱${PDAX_DEPOSIT_MIN_PHP.toLocaleString("en-PH")}.`
    : aboveMax
      ? `InstaPay caps single deposits at ₱${PDAX_DEPOSIT_MAX_PHP.toLocaleString("en-PH")}. Split across multiple deposits for larger amounts.`
      : null;

  return (
    <>
      <h2>Add money via PDAX</h2>

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
            min={PDAX_DEPOSIT_MIN_PHP}
            max={PDAX_DEPOSIT_MAX_PHP}
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
        <div
          className="mt-2 text-[11px]"
          style={{
            color: validationMsg ? "var(--sobre-danger)" : "var(--text-3)",
          }}
        >
          {validationMsg ?? rangeHint}
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
  cancelling,
  alreadyPaidNotice,
  onCancel,
}: {
  status: DepositStatus;
  identifier: string;
  /** Surfaces as a manual "Open checkout" anchor under the spinner so the
   *  user always has a reliable way back to GrabPay if the auto-open got
   *  blocked or the tab was closed. */
  checkoutUrl: string | null;
  /** Disable the cancel affordance while the parent's /cancel is in
   *  flight. Lifted to the modal so backdrop close + inline button
   *  share the same in-flight state. */
  cancelling: boolean;
  /** True once the parent has confirmed PDAX already has the payment.
   *  Swaps the spinner copy to "Finishing your deposit…" and hides the
   *  cancel/checkout affordances; poll-status (still firing below)
   *  advances the row to funded → credited within a few seconds. */
  alreadyPaidNotice: boolean;
  onCancel: () => void;
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
  // first as each new step begins. When PDAX has already received the
  // payment (alreadyPaidNotice), we override the rotation with a single
  // reassuring title since the PENDING_MESSAGES copy ("Waiting for
  // payment…") would be misleading.
  const titles = useMemo(
    () =>
      alreadyPaidNotice && status === "pending"
        ? ["Finishing your deposit…"]
        : rotatingTitlesFor(status),
    [status, alreadyPaidNotice],
  );
  const [titleIdx, setTitleIdx] = useState(0);
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
      // Modulo guards against a stale titleIdx (carried over from a
      // longer rotation) landing outside the new titles array — no
      // reset effect needed.
      title={titles[titleIdx % titles.length]}
      footer={
        status === "pending" && !alreadyPaidNotice ? (
          <div className="flex flex-col items-center gap-2">
            {checkoutUrl ? (
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
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-3)",
                fontSize: 12,
                cursor: cancelling ? "not-allowed" : "pointer",
                textDecoration: "underline",
              }}
            >
              {cancelling ? "Cancelling…" : "Cancel this checkout"}
            </button>
          </div>
        ) : alreadyPaidNotice ? (
          <p
            style={{
              fontSize: 11,
              color: "var(--sobre-accent)",
              textAlign: "center",
              margin: 0,
              maxWidth: 260,
              lineHeight: 1.4,
            }}
          >
            PDAX already has your payment. We&apos;ll finish your deposit
            automatically.
          </p>
        ) : undefined
      }
    />
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
