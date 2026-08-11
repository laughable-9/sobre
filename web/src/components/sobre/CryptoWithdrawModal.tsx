"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { StrKey } from "@stellar/stellar-sdk";

import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { Sheet } from "@/components/sobre/Sheet";
import { useCashoutApproval } from "@/hooks/useCashoutApproval";
import {
  useCryptoWithdraw,
  type CryptoWithdrawOutcome,
} from "@/hooks/useCryptoWithdraw";
import { useTokenRate } from "@/hooks/useTokenRate";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PAYMENT_TOKEN_LABEL,
  STROOPS_PER_TOKEN,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { isEnvelopeApprovalGated } from "@/lib/contract";
import { useCurrency } from "@/lib/currency";
import { renderEnvelopeIcon } from "@/lib/envelopeIcons";
import { shortenAddress } from "@/lib/format";
import { envelopeTotalStroops } from "@/lib/walletTotals";

/**
 * Withdraw to a Stellar wallet address. Replaces the PDAX bank cashout
 * while the fiat ramps are off (see RAMPS_AVAILABLE in lib/config).
 *
 * Two variants share the form:
 *  - "member" draws from one of the three envelopes.
 *  - "subaccount" draws from the caller's own supplementary balance, so
 *    it has no envelope picker and no approval gate.
 *
 * The move is two signed legs (see useCryptoWithdraw) because the
 * contract only ever pays out to the caller. Leg 1 landing while leg 2
 * fails leaves the money in the user's smart wallet, which is what the
 * `retry_send` phase exists to resolve.
 */

/** Memo recorded on the on-chain withdraw. Shows up in the activity feed
 *  next to the family's other envelope withdrawals. */
const WITHDRAW_MEMO = "Sent to a wallet";

type Phase =
  | "input"
  | "awaiting_approval"
  | "signing"
  | "retry_send"
  | "done"
  | "error";

interface Props {
  userAddress: string;
  contractId: string;
  state: WalletState;
  familyWalletId: string | null;
  memberWalletDbId: string | null;
  /** "subaccount" hides the envelope picker and draws from
   *  `balanceStroops` instead of an envelope. Defaults to "member". */
  variant?: "member" | "subaccount";
  /** Pre-select the envelope. Member variant only. */
  initialEnvelope?: EnvelopeName;
  /** Spendable balance for the subaccount variant, in stroops. */
  balanceStroops?: bigint;
  /** True when an admin has locked this supplementary account on chain.
   *  The withdraw would revert, so the modal says so up front. */
  locked?: boolean;
  onClose: () => void;
  onSuccess: (info: { php: number }) => void;
}

export function CryptoWithdrawModal({
  userAddress,
  contractId,
  state,
  familyWalletId,
  memberWalletDbId,
  variant = "member",
  initialEnvelope,
  balanceStroops: subBalanceStroops = 0n,
  locked = false,
  onClose,
  onSuccess,
}: Props) {
  const isSub = variant === "subaccount";
  const [envelope, setEnvelope] = useState<EnvelopeName>(
    initialEnvelope ?? "Groceries",
  );
  const [amountStr, setAmountStr] = useState("");
  const [destination, setDestination] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { phpPerToken } = useTokenRate();
  const { currency } = useCurrency();
  const { withdrawAndSend, sendOnly, pending, step } = useCryptoWithdraw(
    userAddress,
    contractId,
  );

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const isUsd = currency === "USD";
  const symbol = isUsd ? "$" : "₱";
  const locale = isUsd ? "en-US" : "en-PH";

  const envIdx = ENVELOPE_LABELS.indexOf(envelope);
  // envelopeTotalStroops folds any Earn position back in — the contract
  // redeems from USDY inside `withdraw`, so that's the real ceiling.
  const balanceStroops = isSub
    ? subBalanceStroops
    : envelopeTotalStroops(state, envIdx);
  const balanceToken = Number(balanceStroops) / STROOPS_PER_TOKEN;
  const balanceInCurrency = isUsd ? balanceToken : balanceToken * phpPerToken;

  const amountEntered = Number(amountStr);
  const validAmount = Number.isFinite(amountEntered) && amountEntered > 0;
  const amountToken = validAmount
    ? isUsd
      ? amountEntered
      : amountEntered / phpPerToken
    : 0;
  const amountPhp = amountToken * phpPerToken;
  const amountStroops = BigInt(Math.round(amountToken * STROOPS_PER_TOKEN));
  const overspend = validAmount && amountStroops > balanceStroops;

  const destTrimmed = destination.trim();
  const destValid =
    StrKey.isValidEd25519PublicKey(destTrimmed) ||
    StrKey.isValidContract(destTrimmed);
  const destTouchedInvalid = destTrimmed.length > 0 && !destValid;

  // Same gate the PDAX cashout applies: money leaving a locked envelope
  // needs every admin to sign off, whichever rail carries it out.
  // Supplementary balances aren't envelope-scoped, so they skip it.
  const totalAdmins = state.admins.length;
  const needsApproval =
    !isSub && isEnvelopeApprovalGated(state.policy, envelope, totalAdmins);
  const approval = useCashoutApproval({
    familyWalletId,
    memberWalletDbId,
    envelope,
    amountStroops,
  });
  const approvalsRemaining = Math.max(
    0,
    totalAdmins - approval.approvers.length,
  );

  const canSubmit =
    validAmount && !overspend && destValid && !locked && !pending;

  const applyOutcome = (outcome: CryptoWithdrawOutcome) => {
    if (outcome.ok) {
      approval.reset();
      setFailure(null);
      setPhase("done");
      onSuccess({ php: amountPhp });
      return;
    }
    setFailure(outcome.error);
    // stage === "transfer" means leg 1 already debited the envelope. The
    // retry phase must never re-run leg 1 or the family pays twice.
    setPhase(outcome.stage === "transfer" ? "retry_send" : "error");
  };

  const runWithdraw = async () => {
    setPhase("signing");
    applyOutcome(
      await withdrawAndSend({
        envelope: isSub ? null : envelope,
        amountStroops,
        destination: destTrimmed,
        memo: WITHDRAW_MEMO,
      }),
    );
  };

  const runSendOnly = async () => {
    setPhase("signing");
    applyOutcome(await sendOnly({ amountStroops, destination: destTrimmed }));
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    if (!needsApproval) {
      await runWithdraw();
      return;
    }
    setPhase("awaiting_approval");
    const id = await approval.create({ memo: "Withdraw to a wallet" });
    if (!id) setPhase("input");
  };

  // External-sync effect: approval.status is driven by the poll inside
  // useCashoutApproval, so reacting to it here is the correct place.
  useEffect(() => {
    if (phase !== "awaiting_approval") return;
    if (approval.status === "approved") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runWithdraw();
    } else if (approval.status === "denied") {
      setPhase("input");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, approval.status]);

  const envelopeLabel = displayEnvelopeName(envelope, state.envelope_names);
  const sourceLabel = isSub ? "your balance" : envelopeLabel;
  const amountLabel = `${symbol}${(isUsd ? amountToken : amountPhp).toLocaleString(
    locale,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )}`;

  // Backdrop dismiss is off while the passkey prompts are live, and
  // while the retry step is the only path back to money sitting in the
  // user's smart wallet.
  const canClose = phase !== "signing" && phase !== "retry_send";

  if (phase === "awaiting_approval") {
    return (
      <Sheet onClose={onClose} canClose={canClose} ariaLabel="Waiting for approval">
        <h2>Waiting for the other admin{totalAdmins > 2 ? "s" : ""}</h2>
        <p className="sub">
          {envelopeLabel} is a locked envelope. Every admin needs to approve
          before {amountLabel} can leave it.
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
          <p className="text-[12px] mb-3" style={{ color: "var(--sobre-danger)" }}>
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
      <Sheet onClose={onClose} canClose={false} ariaLabel="Sending">
        <CenteredCopy
          icon={<Loader2 size={28} className="animate-spin" />}
          title={
            step === "sending"
              ? "Confirm in your passkey (2 of 2)"
              : "Confirm in your passkey (1 of 2)"
          }
        />
      </Sheet>
    );
  }

  if (phase === "done") {
    return (
      <Sheet onClose={onClose} ariaLabel="Sent">
        <CenteredCopy
          icon={<Check size={28} strokeWidth={2.5} />}
          title="Sent"
          body={`${amountLabel} is on its way to ${shortenAddress(destTrimmed)}.`}
          footer={
            <button
              type="button"
              className="sobre-btn sobre-btn-primary"
              onClick={onClose}
              style={{ padding: "12px 20px" }}
            >
              Done
            </button>
          }
        />
      </Sheet>
    );
  }

  if (phase === "retry_send") {
    return (
      <Sheet onClose={onClose} canClose={false} ariaLabel="Finish sending">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="grid place-items-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--accent-soft)",
              color: "var(--sobre-accent)",
            }}
          >
            <AlertTriangle size={18} strokeWidth={2} />
          </div>
          <h2 style={{ margin: 0 }}>Your money is safe</h2>
        </div>
        <p className="sub">
          {amountLabel} left {sourceLabel} and is sitting in your Sobre wallet.
          It did not reach that address. Check the address and send again. Your
          envelope will not be charged twice.
        </p>

        <DestinationAddressField
          id="crypto-withdraw-retry-dest"
          value={destination}
          onChange={setDestination}
          disabled={pending}
          invalid={destTouchedInvalid}
        />

        {failure ? (
          <FailureNote
            headline={`That wallet cannot receive ${PAYMENT_TOKEN_LABEL} yet. Check the address or try another wallet.`}
            message={failure}
          />
        ) : null}

        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
            disabled={pending}
          >
            Not now
          </button>
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={() => void runSendOnly()}
            disabled={!destValid || pending}
            style={!destValid || pending ? { opacity: 0.5 } : undefined}
          >
            Send again
          </button>
        </div>
      </Sheet>
    );
  }

  if (phase === "error") {
    return (
      <Sheet onClose={onClose} ariaLabel="Withdrawal failed">
        <h2>That did not go through</h2>
        <p className="sub">
          The money is still in {sourceLabel}. Nothing was taken out.
        </p>
        {failure ? <FailureNote message={failure} /> : null}
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={() => setPhase("input")}
          >
            Try again
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Withdraw to a crypto wallet">
      <h2>Withdraw to a crypto wallet</h2>
      <p className="sub">
        Money leaves {isSub ? "your balance" : "the envelope you pick"} and goes
        to the wallet address you enter. You will confirm twice with your
        passkey.
      </p>

      <p
        style={{
          marginTop: 12,
          marginBottom: 16,
          fontSize: 13,
          color: "var(--sobre-text-3)",
        }}
      >
        Bank cash out is unavailable for now.
      </p>

      {locked ? (
        <div
          className="rounded-[10px] px-3 py-3 mb-4 text-[12px]"
          style={{
            background: "var(--sobre-danger-soft)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "var(--sobre-danger)",
          }}
        >
          Your balance is locked. An admin has to unlock you before you can
          withdraw.
        </div>
      ) : null}

      {!isSub ? (
        <div className="sobre-input-group">
          <label>Envelope</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {ENVELOPE_LABELS.map((env, i) => {
              const token = Number(envelopeTotalStroops(state, i)) / STROOPS_PER_TOKEN;
              const bal = isUsd ? token : token * phpPerToken;
              const active = env === envelope;
              return (
                <button
                  key={env}
                  type="button"
                  onClick={() => setEnvelope(env)}
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
                    className="flex items-center gap-1.5 text-[13px] font-medium"
                    style={{
                      color: active ? "var(--sobre-accent)" : "var(--text-1)",
                    }}
                  >
                    {renderEnvelopeIcon(state.envelope_icons?.[i], env, 18)}
                    {displayEnvelopeName(env, state.envelope_names)}
                  </div>
                  <div
                    className="text-[11px] tabular"
                    style={{ color: "var(--text-3)" }}
                  >
                    {symbol}
                    {bal.toLocaleString(locale, {
                      maximumFractionDigits: isUsd ? 2 : 0,
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="sobre-input-group">
        <label htmlFor="crypto-withdraw-amount">
          Amount in {isUsd ? "dollars" : "pesos"}
        </label>
        <div className="sobre-input-wrap">
          <span className="prefix">{symbol}</span>
          <input
            id="crypto-withdraw-amount"
            ref={inputRef}
            className="sobre-input has-prefix tabular"
            type="number"
            inputMode="decimal"
            min="0"
            step={isUsd ? "0.01" : "1"}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="mt-2 text-[12px] tabular" style={{ color: "var(--text-3)" }}>
          Available: {symbol}
          {balanceInCurrency.toLocaleString(locale, {
            maximumFractionDigits: 2,
          })}
        </div>
        {overspend ? (
          <div className="mt-1 text-[12px]" style={{ color: "var(--sobre-danger)" }}>
            More than {sourceLabel} holds.
          </div>
        ) : null}
      </div>

      <DestinationAddressField
        id="crypto-withdraw-dest"
        value={destination}
        onChange={setDestination}
        disabled={pending}
        invalid={destTouchedInvalid}
      />

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
          className="sobre-btn sobre-btn-primary"
          onClick={() => void handleConfirm()}
          disabled={!canSubmit}
          style={!canSubmit ? { opacity: 0.5 } : undefined}
        >
          {needsApproval ? "Request approval" : "Send"}
        </button>
      </div>
    </Sheet>
  );
}

/** The destination-address input block: label, field, two helper lines,
 *  and the invalid-address warning. Shared by the input phase and the
 *  retry_send phase, which differ only in the field's `id`. */
function DestinationAddressField({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  return (
    <div className="sobre-input-group">
      <label htmlFor={id}>Destination wallet address</label>
      <div className="sobre-input-wrap">
        <input
          id={id}
          className="sobre-input"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="mt-2 text-[12px]" style={{ color: "var(--text-3)" }}>
        The Stellar address that receives the money. It starts with G or C.
      </div>
      <div className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
        Use a wallet address you or the recipient controls. Sending to an
        exchange is not supported yet.
      </div>
      {invalid ? (
        <div className="mt-1 text-[12px]" style={{ color: "var(--sobre-danger)" }}>
          That does not look like a Stellar wallet address.
        </div>
      ) : null}
    </div>
  );
}

/** Plain-language line for a failed leg, with the raw chain error kept
 *  underneath for anyone who needs it. */
function FailureNote({
  headline,
  message,
}: {
  headline?: string;
  message: string;
}) {
  return (
    <>
      {headline ? (
        <p className="text-[12px] mb-1" style={{ color: "var(--sobre-danger)" }}>
          {headline}
        </p>
      ) : null}
      <p
        className="text-[11px] break-all mb-3"
        style={{ color: "var(--text-3)" }}
      >
        {message}
      </p>
    </>
  );
}
