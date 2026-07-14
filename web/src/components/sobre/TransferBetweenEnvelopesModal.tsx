"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { Sheet } from "@/components/sobre/Sheet";
import { useCashoutApproval } from "@/hooks/useCashoutApproval";
import { useTransferBetweenEnvelopes } from "@/hooks/useTransferBetweenEnvelopes";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { isEnvelopeApprovalGated } from "@/lib/contract";
import { useCurrency } from "@/lib/currency";
import { envelopeTotalStroops } from "@/lib/walletTotals";

/**
 * Move money between envelopes inside the same Sobre.
 *
 *   1. `withdraw(caller, source, amount, memo)` on this contract —
 *      source envelope debits, tokens land in the user's smart wallet.
 *   2. `deposit_with_split(from=caller, g, t, s)` on the same contract
 *      with only the destination envelope's slot non-zero — user
 *      smart wallet debits, that envelope credits. Net movement is
 *      a pure envelope reallocation.
 *
 *  Multi-admin approval: if the source envelope sits in
 *  `state.policy.protectedEnvelopes` AND the family has 2+ admins,
 *  the move routes through `family_pending_requests` with
 *  `kind='transfer'` first — same infrastructure the cashout and
 *  sub-account gates already use. Solo-admin families skip the wait.
 */
export function TransferBetweenEnvelopesModal({
  userAddress,
  contractId,
  state,
  familyWalletId,
  memberWalletDbId,
  initialEnvelope,
  onClose,
  onSuccess,
  onFlash,
}: {
  userAddress: string;
  contractId: string;
  state: WalletState;
  familyWalletId: string | null;
  memberWalletDbId: string | null;
  /** Pre-select the source envelope when entering from an envelope card. */
  initialEnvelope?: EnvelopeName;
  onClose: () => void;
  onSuccess: () => void;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
}) {
  const [source, setSource] = useState<EnvelopeName>(
    initialEnvelope ?? "Groceries",
  );
  const [destination, setDestination] = useState<EnvelopeName | null>(null);
  // No default value — an amount pre-filled with "500" reads as a
  // suggested number and users tap Send without changing it.
  const [amount, setAmount] = useState<string>("");
  const [phase, setPhase] = useState<
    "input" | "awaiting_approval" | "signing" | "done" | "error"
  >("input");
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const { currency } = useCurrency();
  const isUsd = currency === "USD";
  const symbol = isUsd ? "$" : "₱";
  const numberLocale = isUsd ? "en-US" : "en-PH";
  const { transfer, pending: transferPending, error: transferError, step } =
    useTransferBetweenEnvelopes(userAddress);

  const envIdx = ENVELOPE_LABELS.indexOf(source);
  const sourceBalanceToken =
    Number(envelopeTotalStroops(state, envIdx)) / STROOPS_PER_USDC;
  const sourceBalanceDisplay = isUsd
    ? sourceBalanceToken
    : sourceBalanceToken * PHP_PER_USDC;
  const parsed = Number(amount);
  const validAmount = parsed > 0 && Number.isFinite(parsed);
  // Amount typed is in whatever the currency toggle is set to; convert
  // through USDC (the on-chain unit) before turning into stroops.
  const amountUsdc = validAmount ? (isUsd ? parsed : parsed / PHP_PER_USDC) : 0;
  const stroopsRequested = validAmount
    ? BigInt(Math.round(amountUsdc * STROOPS_PER_USDC))
    : 0n;
  const canSubmit =
    validAmount &&
    parsed <= sourceBalanceDisplay &&
    destination !== null &&
    destination !== source;

  const totalAdmins = state.admins.length;
  const needsApproval = isEnvelopeApprovalGated(
    state.policy,
    source,
    totalAdmins,
  );
  const approval = useCashoutApproval({
    familyWalletId,
    memberWalletDbId,
    envelope: source,
    amountStroops: stroopsRequested,
    kind: "transfer",
    // recipient_address on transfer rows carries the destination
    // envelope for envelope-to-envelope moves. The RLS INSERT policy
    // just requires it to be non-null; the exact shape is a client
    // convention that the approval banner reads back out.
    recipientAddress: destination ? `envelope:${destination}` : null,
  });
  const approvalsRemaining = Math.max(
    0,
    totalAdmins - approval.approvers.length,
  );

  const runOnChain = async () => {
    if (!destination || destination === source || stroopsRequested <= 0n) return;
    setPhase("signing");
    try {
      await transfer({
        contractId,
        sourceEnvelope: source,
        destinationEnvelope: destination,
        amountStroops: stroopsRequested,
      });
      approval.reset();
      const sourceLabel = displayEnvelopeName(source, state.envelope_names);
      const destLabel = displayEnvelopeName(destination, state.envelope_names);
      onFlash(
        `Moved ${symbol}${parsed.toLocaleString(numberLocale, { minimumFractionDigits: 2 })} from ${sourceLabel} to ${destLabel}`,
      );
      onSuccess();
      setPhase("done");
    } catch (e) {
      setFlashMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  useEffect(() => {
    if (phase !== "awaiting_approval") return;
    if (approval.status === "approved") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runOnChain();
    } else if (approval.status === "denied") {
      setPhase("input");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, approval.status]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!needsApproval) {
      await runOnChain();
      return;
    }
    setPhase("awaiting_approval");
    const id = await approval.create({ memo: "Envelope-to-envelope transfer" });
    if (!id) setPhase("input");
  };

  const sourceLabel = displayEnvelopeName(source, state.envelope_names);
  const destinationLabel = destination
    ? displayEnvelopeName(destination, state.envelope_names)
    : null;
  const availableEnvelopes = useMemo(() => ENVELOPE_LABELS, []);

  if (phase === "awaiting_approval") {
    return (
      <Sheet onClose={onClose} ariaLabel="Waiting for approval">
        <h2>Waiting for the other admin{totalAdmins > 2 ? "s" : ""}</h2>
        <p className="sub">
          {sourceLabel} is a locked envelope. Every admin needs to approve
          before {symbol}
          {parsed.toLocaleString(numberLocale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          can move to {destinationLabel}.
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
            onClick={() => {
              void approval.cancel();
              setPhase("input");
            }}
          >
            Cancel request
          </button>
        </div>
      </Sheet>
    );
  }

  if (phase === "signing") {
    return (
      <Sheet onClose={onClose} ariaLabel="Moving money">
        <CenteredCopy
          icon={<Loader2 size={28} className="animate-spin" />}
          title={
            step === "depositing"
              ? "Confirm in your passkey (2 of 2)"
              : "Confirm in your passkey (1 of 2)"
          }
        />
      </Sheet>
    );
  }

  if (phase === "done") {
    return (
      <Sheet onClose={onClose} ariaLabel="Moved">
        <h2>Moved</h2>
        <p className="sub">
          {symbol}
          {parsed.toLocaleString(numberLocale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          landed in {destinationLabel}.
        </p>
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  if (phase === "error") {
    return (
      <Sheet onClose={onClose} ariaLabel="Move failed">
        <h2>Something went wrong</h2>
        <p
          className="sub"
          style={{ color: "var(--sobre-danger)" }}
        >
          {flashMsg ?? transferError ?? "The move couldn't complete."}
        </p>
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={() => setPhase("input")}
          >
            Try again
          </button>
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Move between envelopes">
      <h2>Move to another envelope</h2>

      <div className="sobre-input-group">
        <label>From envelope</label>
        <div
          key={`from-${source}`}
          className="grid grid-cols-3 gap-2 mt-1 sobre-fade-in"
        >
          {availableEnvelopes.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setSource(e);
                if (destination === e) setDestination(null);
              }}
              className="rounded-[10px] text-[13px] px-3 py-2"
              style={{
                border:
                  source === e
                    ? "1.5px solid var(--sobre-accent)"
                    : "1px solid var(--border)",
                background:
                  source === e ? "var(--accent-soft)" : "var(--surface)",
                color:
                  source === e ? "var(--sobre-accent)" : "var(--text-1)",
                fontWeight: 600,
                cursor: "pointer",
                transition:
                  "background 160ms ease, color 160ms ease, border-color 160ms ease",
              }}
            >
              {displayEnvelopeName(e, state.envelope_names)}
            </button>
          ))}
        </div>
        <div
          className="mt-2 text-[12px] tabular"
          style={{ color: "var(--text-3)" }}
        >
          Available: {symbol}
          {sourceBalanceDisplay.toLocaleString(numberLocale, {
            maximumFractionDigits: 2,
          })}
        </div>
      </div>

      <div className="sobre-input-group">
        <label>To envelope</label>
        <div
          key={`to-${destination ?? "none"}`}
          className="grid grid-cols-3 gap-2 mt-1 sobre-fade-in"
        >
          {availableEnvelopes.map((e) => {
            const disabled = e === source;
            const active = destination === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => !disabled && setDestination(e)}
                disabled={disabled}
                className="rounded-[10px] text-[13px] px-3 py-2"
                style={{
                  border: active
                    ? "1.5px solid var(--sobre-accent)"
                    : "1px solid var(--border)",
                  background: active
                    ? "var(--accent-soft)"
                    : disabled
                      ? "var(--surface-alt)"
                      : "var(--surface)",
                  color: active
                    ? "var(--sobre-accent)"
                    : disabled
                      ? "var(--text-3)"
                      : "var(--text-1)",
                  fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                  transition:
                    "background 160ms ease, color 160ms ease, border-color 160ms ease, opacity 160ms ease",
                }}
              >
                {displayEnvelopeName(e, state.envelope_names)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sobre-input-group">
        <label>Amount</label>
        <div className="flex items-center gap-1">
          <span
            style={{ color: "var(--text-3)", fontSize: 16 }}
            aria-hidden
          >
            {symbol}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Move amount in ${isUsd ? "USD" : "PHP"}`}
            style={{
              flex: 1,
              fontSize: 20,
              fontVariantNumeric: "tabular-nums",
              background: "transparent",
              border: "none",
              outline: "none",
              padding: "4px 0",
              borderBottom: "1px solid var(--border-strong)",
              color: "var(--text-1)",
            }}
          />
        </div>
        {parsed > sourceBalanceDisplay && validAmount ? (
          <div
            className="mt-1 text-[12px]"
            style={{ color: "var(--sobre-danger)" }}
          >
            More than {sourceLabel} holds.
          </div>
        ) : null}
      </div>

      <div className="sobre-modal-actions">
        <button
          type="button"
          className="sobre-btn sobre-btn-soft"
          onClick={onClose}
          disabled={transferPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sobre-btn sobre-btn-primary"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || transferPending}
          style={
            !canSubmit || transferPending ? { opacity: 0.5 } : undefined
          }
        >
          {needsApproval ? "Request approval" : "Move"}
        </button>
      </div>
    </Sheet>
  );
}
