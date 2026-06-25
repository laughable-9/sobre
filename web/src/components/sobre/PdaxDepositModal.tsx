"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, Copy, ExternalLink, Loader2, Send } from "lucide-react";

import { useDeposit } from "@/hooks/useDeposit";
import { usePdaxDeposit, type DepositStatus } from "@/hooks/usePdaxDeposit";
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
type Phase = "input" | "awaiting" | "confirm" | "splitting" | "done" | "failed";

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
  onSuccess,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  onClose: () => void;
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
    error: depositError,
  } = useDeposit(userAddress, contractId);

  const [splitting, setSplitting] = useState(false);
  const { phpPerToken } = useTokenRate();

  // Modal mounts → focus the amount input so the user can type immediately.
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const amountPhp = Number(amountStr);
  const validAmount = Number.isFinite(amountPhp) && amountPhp > 0;
  const expectedToken = amountPhp / phpPerToken;

  const phase: Phase = !row
    ? "input"
    : splitting
      ? "splitting"
      : phaseFromStatus(row.status);

  const error = pdaxError ?? depositError;

  const handleGenerate = async () => {
    if (!validAmount) return;
    try {
      const result = await initiate(amountPhp);
      window.open(result.paymentCheckoutUrl, "_blank", "noopener,noreferrer");
    } catch {
      // surfaces via hook error state
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
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
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
            onCancel={onClose}
            onGenerate={() => void handleGenerate()}
            error={error}
          />
        ) : null}

        {phase === "awaiting" && row ? (
          <AwaitingStep
            url={row.payment_checkout_url}
            status={row.status}
            amountPhp={row.amount_php}
            identifier={row.identifier}
            onClose={onClose}
          />
        ) : null}

        {phase === "confirm" && row ? (
          <ConfirmStep
            amountToken={row.amount_usdc ?? expectedToken}
            phpPerToken={phpPerToken}
            state={state}
            pending={depositPending || pdaxPending}
            onConfirm={() => void handleConfirmSplit()}
            onCancel={onClose}
            error={error}
          />
        ) : null}

        {phase === "splitting" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="sobre-spin" />}
            title="Splitting across envelopes…"
            body="Confirm with your passkey when prompted."
          />
        ) : null}

        {phase === "done" ? (
          <CenteredCopy
            icon={<Check size={28} strokeWidth={2.5} />}
            title="Money landed"
            body="Your envelopes have been updated."
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
            body={row.failure_reason ?? "The deposit didn't complete. Try again."}
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
  url,
  status,
  amountPhp,
  identifier,
  onClose,
}: {
  url: string | null;
  status: DepositStatus;
  amountPhp: number;
  identifier: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // Poll PDAX's fiat/transactions every 3s. When the cash-in flips to
  // COMPLETED on their side, the route auto-orchestrates the trade +
  // withdraw and flips our row to 'credited' — Supabase Realtime then
  // surfaces the change to the parent and the modal advances.
  useEffect(() => {
    if (status === "credited" || status === "split" || status === "failed") {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        await fetch(`/api/pdax/deposits/${identifier}/poll-status`, {
          method: "GET",
        });
      } catch {
        // poll is best-effort; the next tick will retry
      }
    };
    void tick();
    // 1s polling: the funded→credited transition trips as soon as the
    // Horizon payment lands at the relay, so polling faster shaves real
    // wall-clock latency rather than just spamming the route.
    const t = setInterval(() => {
      if (!cancelled) void tick();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [identifier, status]);

  const simulate = async () => {
    setSimulating(true);
    setSimError(null);
    try {
      const res = await fetch(
        `/api/pdax/deposits/${identifier}/simulate-complete`,
        { method: "POST" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
    } finally {
      setSimulating(false);
    }
  };
  const labelByStatus: Record<DepositStatus, string> = {
    pending: "Waiting for your payment",
    funded: "Payment received — crediting your wallet",
    credited: "Funds landed",
    split: "Done",
    failed: "Failed",
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <h2>Waiting for your payment</h2>
      <p className="sub">
        Pay ₱{amountPhp.toLocaleString("en-PH")} on the PDAX checkout page
        we opened. Sobre updates the second PDAX confirms the payment.
      </p>

      {url ? (
        <div
          className="rounded-[10px] p-3 flex items-center gap-3 mb-3"
          style={{
            background: "var(--surface-alt)",
            border: "1.5px dashed var(--border-strong)",
          }}
        >
          <ExternalLink
            size={18}
            strokeWidth={2}
            style={{ color: "var(--sobre-accent)", flexShrink: 0 }}
          />
          <code
            className="text-[12px] break-all flex-1"
            style={{ color: "var(--text-1)" }}
          >
            {url}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="grid place-items-center"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              color: "var(--text-2)",
              flexShrink: 0,
            }}
            aria-label="Copy link"
          >
            {copied ? (
              <Check size={16} strokeWidth={2.5} />
            ) : (
              <Copy size={16} strokeWidth={2} />
            )}
          </button>
        </div>
      ) : null}

      <div
        className="flex items-center gap-3 p-3 rounded-[10px] mb-4"
        style={{ background: "var(--accent-soft)" }}
      >
        <Loader2
          size={18}
          className="sobre-spin"
          style={{ color: "var(--sobre-accent)" }}
        />
        <span className="text-[13px]" style={{ color: "var(--text-1)" }}>
          {labelByStatus[status]}
        </span>
      </div>

      {/* Dev shortcut: skip the PDAX hosted-payment page and run the
          PHP trade + crypto withdraw against PDAX UAT directly. Useful
          while the test.web.pdax.ph payment page is IP-blocked or when
          localhost can't receive PDAX webhooks. */}
      <details className="mb-3" style={{ color: "var(--text-3)" }}>
        <summary className="text-[12px] cursor-pointer">
          Dev: simulate PDAX completion
        </summary>
        <button
          type="button"
          className="sobre-btn sobre-btn-soft mt-2"
          style={{ padding: "8px 12px", fontSize: 12 }}
          onClick={() => void simulate()}
          disabled={simulating}
        >
          {simulating
            ? "Triggering PDAX trade + withdraw…"
            : "Simulate fiat-completed → trigger crypto withdraw"}
        </button>
        {simError ? (
          <p
            className="text-xs break-all mt-2"
            style={{ color: "var(--sobre-danger)" }}
          >
            {simError}
          </p>
        ) : null}
      </details>

      <div className="sobre-modal-actions">
        <button className="sobre-btn sobre-btn-soft" onClick={onClose}>
          Close — keep paying
        </button>
        {url ? (
          <a
            className="sobre-btn sobre-btn-primary"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} strokeWidth={2.2} />
            Open PDAX
          </a>
        ) : null}
      </div>
    </>
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

function CenteredCopy({
  icon,
  title,
  body,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="text-center py-4">
      <div
        className="grid place-items-center mx-auto mb-4"
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          color: "var(--sobre-accent)",
        }}
      >
        {icon}
      </div>
      <h2 className="mb-2">{title}</h2>
      <p className="sub mb-4">{body}</p>
      {footer ? <div className="sobre-modal-actions">{footer}</div> : null}
    </div>
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
