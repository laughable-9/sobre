"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  Clock,
  GraduationCap,
  Loader2,
  ShoppingCart,
  Sprout,
} from "lucide-react";

import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { useCashoutSignatures } from "@/hooks/useCashoutSignatures";
import {
  usePdaxWithdraw,
  type WithdrawStatus,
} from "@/hooks/usePdaxWithdraw";
import { usePollStatus } from "@/hooks/usePollStatus";
import { useTokenRate } from "@/hooks/useTokenRate";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_TOKEN,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { maskAccountNumber } from "@/lib/format";
import { backdropClose } from "@/lib/ui";

const QUICK_PHP = [100, 500, 1000, 5000];

/** PDAX UAT supports these two banks for InstaPay payouts. Keep the list
 *  short and explicit — anything else will be rejected by /fiat/withdraw. */
const BANKS = [
  { code: "BASECPH", name: "Security Bank" },
  { code: "BACTBPH", name: "CTBC Bank" },
] as const;

const ICONS: Record<EnvelopeName, React.ReactNode> = {
  Groceries: <ShoppingCart size={18} strokeWidth={2} />,
  Tuition: <GraduationCap size={18} strokeWidth={2} />,
  Savings: <Sprout size={18} strokeWidth={2} />,
};

interface BankRecord {
  bank_code: string;
  account_name: string;
  account_number: string;
}

type LocalPhase =
  | "loading_bank"
  | "register_bank"
  | "input"
  | "signing";

type Phase = LocalPhase | "awaiting" | "done" | "failed";

/** Maps the server-side row status to the phase the user sees. Returns null
 *  for pending/undefined so the modal's local phase wins until the user-
 *  signed leg lands (which flips status to 'spent' via /confirmed). */
function phaseFromStatus(status: WithdrawStatus | undefined): Phase | null {
  switch (status) {
    case "spent":
    case "transferred":
    case "converted":
      return "awaiting";
    case "paid":
      return "done";
    case "failed":
      return "failed";
    case "pending":
    default:
      return null;
  }
}

/** Status-line copy for the AwaitingStep spinner. Hoisted so the record
 *  literal isn't allocated per-render. */
const STATUS_LABELS: Record<WithdrawStatus, string> = {
  pending: "Preparing…",
  spent: "Sending to PDAX…",
  transferred: "PDAX received the funds — converting to pesos",
  converted: "Sending to your bank via InstaPay",
  paid: "Done",
  failed: "Failed",
};

export function PdaxWithdrawModal({
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
  onSuccess: (info: { php: number }) => void;
}) {
  const [localPhase, setLocalPhase] = useState<LocalPhase>("loading_bank");
  const [bank, setBank] = useState<BankRecord | null>(null);
  const [envelope, setEnvelope] = useState<EnvelopeName>("Groceries");
  const [amountStr, setAmountStr] = useState("500");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { phpPerToken } = useTokenRate();
  const {
    initiate,
    confirmSigned,
    row,
    pending: pdaxPending,
    error: pdaxError,
  } = usePdaxWithdraw(contractId);
  const {
    signAndForward,
    pending: signPending,
    error: signError,
    step: signStep,
  } = useCashoutSignatures(userAddress, contractId);

  // Load the member's default bank on mount.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/member/bank")
      .then((r) => r.json())
      .then((j: { bank: BankRecord | null }) => {
        if (cancelled) return;
        if (j.bank) {
          setBank(j.bank);
          setLocalPhase("input");
        } else {
          setLocalPhase("register_bank");
        }
      })
      .catch(() => {
        if (!cancelled) setLocalPhase("register_bank");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived phase: server-driven status wins for spent/.../paid/failed,
  // local state owns the pre-signing UI. Computing this inline avoids an
  // extra effect that would cascade-render.
  const phase: Phase = phaseFromStatus(row?.status) ?? localPhase;

  // Drive the server-side pipeline by hitting poll-status. Each call is a
  // single state-machine step; Realtime relays row updates back to the hook.
  usePollStatus(
    row?.identifier
      ? `/api/pdax/withdrawals/${row.identifier}/poll-status`
      : null,
    phase === "awaiting",
  );

  // Notify the parent when the cashout reaches paid.
  useEffect(() => {
    if (phase === "done" && row?.amount_php) {
      onSuccess({ php: Number(row.amount_php) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, row?.amount_php]);

  const envIdx = ENVELOPE_LABELS.indexOf(envelope);
  const balanceStroops = state.balances[envIdx] ?? 0n;
  const balanceToken = Number(balanceStroops) / STROOPS_PER_TOKEN;
  const balancePhp = balanceToken * phpPerToken;

  const amountPhp = Number(amountStr);
  const validAmount = Number.isFinite(amountPhp) && amountPhp > 0;
  const amountToken = validAmount ? amountPhp / phpPerToken : 0;
  const amountStroops = BigInt(Math.round(amountToken * STROOPS_PER_TOKEN));
  const overspend = amountStroops > balanceStroops;

  // ─── Action handlers ──────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!validAmount || overspend || !bank) return;
    setLocalPhase("signing");
    try {
      const { relayG } = await initiate({
        envelope,
        amountToken,
        amountPhp,
        bankCode: bank.bank_code,
        accountName: bank.account_name,
        accountNumber: bank.account_number,
      });

      const { spendTxHash, forwardTxHash } = await signAndForward({
        envelope,
        amountStroops,
        relayG,
      });

      await confirmSigned({ spendTxHash, forwardTxHash });
      // Row goes to 'spent' via Realtime; phase advances to awaiting in the
      // status effect above.
    } catch {
      // Errors surface via hook state. Walk back to input so the user can
      // retry. If the spend leg landed but the forward leg didn't, the XLM
      // is in the user's smart wallet — they can retry, the spend amount is
      // additive, and the pdax_withdrawals row still says 'pending' so a
      // retry just lands a new SAC transfer to relay.
      setLocalPhase("input");
    }
  };

  const error = pdaxError ?? signError;

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        {phase === "loading_bank" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="sobre-spin" />}
            title="Loading…"
            body="Checking your registered bank."
          />
        ) : null}

        {phase === "register_bank" ? (
          <RegisterBankStep
            onCancel={onClose}
            onSaved={(b) => {
              setBank(b);
              setLocalPhase("input");
            }}
          />
        ) : null}

        {phase === "input" && bank ? (
          <InputStep
            envelope={envelope}
            setEnvelope={setEnvelope}
            envelopeNames={state.envelope_names}
            balances={state.balances}
            phpPerToken={phpPerToken}
            amountStr={amountStr}
            setAmountStr={setAmountStr}
            inputRef={inputRef}
            validAmount={validAmount}
            overspend={overspend}
            balancePhp={balancePhp}
            amountToken={amountToken}
            bank={bank}
            onChangeBank={() => setLocalPhase("register_bank")}
            onCancel={onClose}
            onConfirm={() => void handleConfirm()}
            pending={pdaxPending || signPending}
            error={error}
          />
        ) : null}

        {phase === "signing" ? (
          <SigningStep step={signStep} amountPhp={amountPhp} />
        ) : null}

        {phase === "awaiting" && row ? (
          <AwaitingStep
            status={row.status}
            amountPhp={Number(row.amount_php ?? amountPhp)}
            bankName={
              BANKS.find((b) => b.code === row.beneficiary_bank_code)?.name ??
              row.beneficiary_bank_code
            }
            accountNumber={row.beneficiary_account_number}
            onClose={onClose}
          />
        ) : null}

        {phase === "done" && row ? (
          <CenteredCopy
            icon={<Check size={28} strokeWidth={2.5} />}
            title="Sent to your bank"
            body={`₱${Number(row.amount_php ?? amountPhp).toLocaleString(
              "en-PH",
              { minimumFractionDigits: 2 },
            )} is on its way via InstaPay.`}
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
            body={row.failure_reason ?? "The cashout didn't complete."}
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
  envelope,
  setEnvelope,
  envelopeNames,
  balances,
  phpPerToken,
  amountStr,
  setAmountStr,
  inputRef,
  validAmount,
  overspend,
  balancePhp,
  amountToken,
  bank,
  onChangeBank,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  envelope: EnvelopeName;
  setEnvelope: (e: EnvelopeName) => void;
  envelopeNames: string[];
  balances: readonly bigint[];
  phpPerToken: number;
  amountStr: string;
  setAmountStr: (s: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  validAmount: boolean;
  overspend: boolean;
  balancePhp: number;
  amountToken: number;
  bank: BankRecord;
  onChangeBank: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
}) {
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bankName = useMemo(
    () => BANKS.find((b) => b.code === bank.bank_code)?.name ?? bank.bank_code,
    [bank.bank_code],
  );
  const maskedAcct = maskAccountNumber(bank.account_number);

  return (
    <>
      <h2>Cash out to your bank</h2>
      <p className="sub">
        Pull pesos from an envelope to your registered bank account via
        InstaPay. Usually lands in under a minute.
      </p>

      <div className="sobre-input-group">
        <label>Envelope</label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {ENVELOPE_LABELS.map((env, i) => {
            const bal =
              (Number(balances[i] ?? 0n) / STROOPS_PER_TOKEN) * phpPerToken;
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
                  {ICONS[env]}
                  {displayEnvelopeName(env, envelopeNames)}
                </div>
                <div className="text-[11px] tabular" style={{ color: "var(--text-3)" }}>
                  ₱{bal.toLocaleString("en-PH", { maximumFractionDigits: 0 })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sobre-input-group">
        <label htmlFor="cashout-amount">Amount in pesos</label>
        <div className="sobre-input-wrap">
          <span className="prefix">₱</span>
          <input
            id="cashout-amount"
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
          {QUICK_PHP.map((q) => {
            const disabled = pending || q > balancePhp;
            return (
              <button
                key={q}
                type="button"
                className={amountStr === String(q) ? "active" : ""}
                onClick={() => setAmountStr(String(q))}
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
                    ? `Only ₱${balancePhp.toFixed(0)} available in this envelope`
                    : undefined
                }
              >
                ₱{q.toLocaleString()}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[12px]" style={{ color: "var(--text-3)" }}>
          Available: ₱{balancePhp.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
          {amountToken > 0 ? (
            <>
              {" · "}
              <span className="tabular">{amountToken.toFixed(4)} XLM</span>
            </>
          ) : null}
        </div>
      </div>

      {overspend && validAmount ? (
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
            <b>Not enough in this envelope.</b> Pick a smaller amount or
            another envelope.
          </div>
        </div>
      ) : null}

      <div
        className="flex items-center justify-between p-3 rounded-[10px] mb-4"
        style={{ background: "var(--surface-alt)" }}
      >
        <div className="flex items-center gap-3">
          <ArrowDownToLine
            size={18}
            strokeWidth={2}
            style={{ color: "var(--sobre-accent)" }}
          />
          <div>
            <div className="text-[13px] font-medium" style={{ color: "var(--text-1)" }}>
              {bank.account_name}
            </div>
            <div className="text-[11px] tabular" style={{ color: "var(--text-3)" }}>
              {bankName} · {maskedAcct}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onChangeBank}
          disabled={pending}
          className="text-[12px]"
          style={{
            color: "var(--sobre-accent)",
            background: "transparent",
            border: "none",
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          Change
        </button>
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
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={onConfirm}
          disabled={!validAmount || overspend || pending}
          style={
            !validAmount || overspend || pending
              ? { opacity: 0.5 }
              : {}
          }
        >
          {pending ? "Preparing…" : "Confirm cashout"}
        </button>
      </div>
    </>
  );
}

function SigningStep({
  step,
  amountPhp,
}: {
  step: "idle" | "spending" | "forwarding";
  amountPhp: number;
}) {
  const title =
    step === "forwarding"
      ? "Forwarding to PDAX"
      : "Withdrawing from envelope";
  const body =
    step === "forwarding"
      ? `Step 2 of 2 — confirm with your passkey to send the XLM to PDAX.`
      : `Step 1 of 2 — confirm with your passkey to release ₱${amountPhp.toLocaleString(
          "en-PH",
        )}.`;
  return (
    <CenteredCopy
      icon={<Loader2 size={28} className="sobre-spin" />}
      title={title}
      body={body}
    />
  );
}

function AwaitingStep({
  status,
  amountPhp,
  bankName,
  accountNumber,
  onClose,
}: {
  status: WithdrawStatus;
  amountPhp: number;
  bankName: string;
  accountNumber: string;
  onClose: () => void;
}) {
  return (
    <>
      <h2>Cashing out</h2>
      <p className="sub">
        ₱{amountPhp.toLocaleString("en-PH", { minimumFractionDigits: 2 })} →{" "}
        {bankName} · {maskAccountNumber(accountNumber)}
      </p>

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
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className="sobre-modal-actions">
        <button className="sobre-btn sobre-btn-soft" onClick={onClose}>
          Close — keep going
        </button>
      </div>
    </>
  );
}

function RegisterBankStep({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (b: BankRecord) => void;
}) {
  const [bankCode, setBankCode] = useState<string>(BANKS[0].code);
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = accountName.trim().length > 0 && accountNumber.trim().length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/bank", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bank_code: bankCode,
          account_name: accountName.trim(),
          account_number: accountNumber.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onSaved({
        bank_code: bankCode,
        account_name: accountName.trim(),
        account_number: accountNumber.trim(),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2>Register your bank</h2>
      <p className="sub">
        Cashouts land in your PHP bank account via InstaPay. PDAX UAT supports
        two banks today.
      </p>

      <div className="sobre-input-group">
        <label>Bank</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {BANKS.map((b) => {
            const active = b.code === bankCode;
            return (
              <button
                key={b.code}
                type="button"
                onClick={() => setBankCode(b.code)}
                disabled={saving}
                className="p-3 rounded-[10px] text-left"
                style={{
                  border: active
                    ? "1.5px solid var(--sobre-accent)"
                    : "1px solid var(--border)",
                  background: active
                    ? "var(--accent-soft)"
                    : "var(--surface-alt)",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                <div
                  className="text-[13px] font-medium"
                  style={{
                    color: active ? "var(--sobre-accent)" : "var(--text-1)",
                  }}
                >
                  {b.name}
                </div>
                <div
                  className="text-[11px] tabular mt-0.5"
                  style={{ color: "var(--text-3)" }}
                >
                  {b.code}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sobre-input-group">
        <label htmlFor="cashout-acct-name">Account holder name</label>
        <input
          id="cashout-acct-name"
          className="sobre-input"
          type="text"
          placeholder="Juan Dela Cruz"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          disabled={saving}
          maxLength={120}
        />
      </div>

      <div className="sobre-input-group">
        <label htmlFor="cashout-acct-num">Account number</label>
        <input
          id="cashout-acct-num"
          className="sobre-input tabular"
          type="text"
          inputMode="numeric"
          placeholder="123456789012"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9]/g, ""))}
          disabled={saving}
          maxLength={32}
        />
      </div>

      {err ? (
        <p
          className="text-xs break-all mb-3"
          style={{ color: "var(--sobre-danger)" }}
        >
          {err}
        </p>
      ) : null}

      <div className="sobre-modal-actions">
        <button
          className="sobre-btn sobre-btn-soft"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={() => void handleSave()}
          disabled={!valid || saving}
          style={!valid || saving ? { opacity: 0.5 } : {}}
        >
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </>
  );
}

