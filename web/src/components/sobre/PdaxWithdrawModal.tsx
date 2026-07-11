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
import {
  clearCashoutRecovery,
  useCashoutSignatures,
} from "@/hooks/useCashoutSignatures";
import {
  usePdaxWithdraw,
  type WithdrawStatus,
} from "@/hooks/usePdaxWithdraw";
import { usePollStatus } from "@/hooks/usePollStatus";
import { useTokenRate } from "@/hooks/useTokenRate";
import type { WalletState } from "@/hooks/useWalletState";
import { BANKS } from "@/lib/banks";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_TOKEN,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import {
  readCashoutRecovery,
  type CashoutRecoverySnapshot,
} from "@/lib/cashoutRecovery";
import { maskAccountNumber } from "@/lib/format";
import { Sheet } from "@/components/sobre/Sheet";

const QUICK_PHP = [100, 500, 1000, 5000];

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
  | "signing"
  | "recovery_prompt";

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
 *  literal isn't allocated per-render. Each fits on one line so the
 *  modal height stays stable as it advances.
 *
 *  Honest labels at every stage — "paying out" doesn't claim the bank
 *  has it yet; "settling at your bank" matches the real wait while
 *  InstaPay actually moves the money. */
const STATUS_LABELS: Record<WithdrawStatus, string> = {
  pending: "Preparing…",
  spent: "Forwarding to PDAX…",
  transferred: "Converting to pesos…",
  converted: "Sending payout request…",
  processing: "Settling at your bank…",
  paid: "Done",
  failed: "Failed",
};

export function PdaxWithdrawModal({
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
  onClose: () => void;
  /** Legacy callback kept for prop compatibility, never fires now that
   *  the modal locks itself closed during every in-flight phase. */
  onCancelMidFlight?: () => void;
  onSuccess: (info: { php: number }) => void;
  /** Re-open the modal at the awaiting view for an existing cashout. */
  resumeIdentifier?: string;
  /** Same contract as the deposit modal — surfaces the active row id so
   *  the dashboard can filter it out of the PENDING bucket while open. */
  onActiveIdentifierChange?: (identifier: string | null) => void;
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
  } = usePdaxWithdraw(contractId, resumeIdentifier);

  // Mirror the deposit pattern: surface the active row identifier so the
  // dashboard can hide it from the PENDING bucket while we're handling it.
  useEffect(() => {
    onActiveIdentifierChange?.(row?.identifier ?? null);
    return () => onActiveIdentifierChange?.(null);
  }, [row?.identifier, onActiveIdentifierChange]);
  const {
    signAndForward,
    retryForward,
    pending: signPending,
    error: signError,
    step: signStep,
  } = useCashoutSignatures(userAddress, contractId);

  // Recovery state. Either of these being set means the modal opens at
  // the recovery_prompt phase instead of the input form. Snapshot wins
  // when both are present (localStorage carries the bank info verbatim;
  // the server endpoint is the fallback for users who lost it).
  const [recoverySnapshot, setRecoverySnapshot] =
    useState<CashoutRecoverySnapshot | null>(null);
  const [recoveryFromServer, setRecoveryFromServer] = useState<{
    identifier: string;
    spendTxHash: string;
    amountStroops: string;
    amountPhp: number;
    amountToken: number;
    envelope: EnvelopeName;
    bankCode: string;
    accountName: string;
    accountNumber: string;
  } | null>(null);

  // Decide the initial local phase: recovery_prompt vs input/register_bank.
  // Re-runs when resumeIdentifier changes so the activity-feed "tap to
  // resume" affordance targets the right row.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Localstorage / in-memory snapshot. When resumeIdentifier is set
      // we accept the snapshot only if it matches — otherwise the user
      // tapped a specific PENDING row and the snapshot might belong to
      // a different (older) orphan we don't want to redirect them to.
      const snap = readCashoutRecovery();
      if (
        snap &&
        snap.contractId === contractId &&
        (!resumeIdentifier || snap.identifier === resumeIdentifier) &&
        !cancelled
      ) {
        setRecoverySnapshot(snap);
        setLocalPhase("recovery_prompt");
        return;
      }
      // Server fallback for users without a snapshot: scan
      // pdax_withdrawals + on-chain Spend events to find pending rows
      // whose spend already landed. Match by resumeIdentifier when set
      // so we don't surface a different orphan than the one the user
      // just tapped.
      try {
        const res = await fetch(
          `/api/pdax/withdrawals/recoverable?contract_id=${encodeURIComponent(contractId)}`,
        );
        if (res.ok) {
          const json = (await res.json()) as {
            recoverable: Array<{
              identifier: string;
              envelope: EnvelopeName;
              amountStroops: string;
              amountPhp: number;
              amountToken: number;
              beneficiary_bank_code: string;
              beneficiary_account_name: string;
              beneficiary_account_number: string;
              spendTxHash: string;
            }>;
          };
          const items = json.recoverable ?? [];
          const r = resumeIdentifier
            ? items.find((x) => x.identifier === resumeIdentifier)
            : items[0];
          // The state-setting branch below carries the load-bearing
          // !cancelled check; redundant pair above is gone.
          if (r && !cancelled) {
            setRecoveryFromServer({
              identifier: r.identifier,
              spendTxHash: r.spendTxHash,
              amountStroops: r.amountStroops,
              amountPhp: r.amountPhp,
              amountToken: r.amountToken,
              envelope: r.envelope,
              bankCode: r.beneficiary_bank_code,
              accountName: r.beneficiary_account_name,
              accountNumber: r.beneficiary_account_number,
            });
            setLocalPhase("recovery_prompt");
            return;
          }
        }
      } catch {
        // server-side scan failed; fall through.
      }
      // No recovery match. When the user came in via "tap to resume" we
      // do NOT load the bank and drop them at InputStep — they didn't
      // ask to start a fresh cashout. Stay at the loading spinner so
      // the next heartbeat / retry can still surface the prompt. For a
      // fresh "Cash out" open (no resumeIdentifier), proceed to bank
      // load → input.
      if (resumeIdentifier) return;
      try {
        const r = await fetch("/api/member/bank");
        const j = (await r.json()) as { bank: BankRecord | null };
        if (cancelled) return;
        if (j.bank) {
          setBank(j.bank);
          setLocalPhase("input");
        } else {
          setLocalPhase("register_bank");
        }
      } catch {
        if (!cancelled) setLocalPhase("register_bank");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId, resumeIdentifier]);

  // Derived phase: server-driven status wins for spent/.../paid/failed,
  // local state owns the pre-signing UI. Computing this inline avoids an
  // extra effect that would cascade-render.
  const phase: Phase = phaseFromStatus(row?.status) ?? localPhase;

  // The user can SAFELY close the modal once the on-chain ops have
  // landed — the rest is server-side, the activity feed shows live
  // progress, and we'll surface the final outcome via a toast when the
  // money lands in their bank. Trapping them in the modal for 30+
  // seconds of server settlement feels custodial in a bad way.
  //
  // LOCKED states (close ignored):
  // - signing: passkey prompts active, on-chain ops in flight
  // - awaiting + spent: XLM at relay but server hasn't claimed the
  //   forward yet — closing here risks a half-claimed row.
  //
  // CLOSABLE while still in flight (`transferred`, `converted`,
  // `processing`): server-side pipeline continues regardless, the
  // activity feed surfaces the live state, and the dashboard flashes
  // "₱X arrived in your <bank>" when status hits `paid`.
  //
  // Pre-signing (input/register_bank/loading_bank) and terminal
  // (done/failed) close normally.
  const handleClose = () => {
    const locked =
      phase === "signing" || (phase === "awaiting" && row?.status === "spent");
    if (locked) return;
    onClose();
  };

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
      const { identifier, relayG } = await initiate({
        envelope,
        amountToken,
        amountPhp,
        bankCode: bank.bank_code,
        accountName: bank.account_name,
        accountNumber: bank.account_number,
      });

      const { spendTxHash, forwardTxHash } = await signAndForward({
        identifier,
        envelope,
        amountStroops,
        amountPhp,
        amountToken,
        relayG,
        bankCode: bank.bank_code,
        accountName: bank.account_name,
        accountNumber: bank.account_number,
      });

      await confirmSigned({ spendTxHash, forwardTxHash });
      // /confirmed landed the row at status='spent' — the recovery
      // snapshot is no longer load-bearing.
      clearCashoutRecovery();
    } catch {
      // CRITICAL: if signAndForward saved a snapshot (i.e. the spend
      // landed before whatever failed), DO NOT route back to the input
      // form. Re-running handleConfirm would fire another spend and
      // debit the envelope a second time — which is exactly what
      // Kyle hit before this fix. Route to the recovery prompt so the
      // next action is retryForward, not signAndForward.
      const snap = readCashoutRecovery();
      if (snap) {
        setRecoverySnapshot(snap);
        setLocalPhase("recovery_prompt");
      } else {
        setLocalPhase("input");
      }
    }
  };

  // Recovery path: skip the spend (it already landed) and re-attempt only
  // the SAC transfer + /confirmed. snap takes precedence over server data
  // when both are present.
  const handleResumeRecovery = async () => {
    const source =
      recoverySnapshot ??
      (recoveryFromServer
        ? {
            identifier: recoveryFromServer.identifier,
            spendTxHash: recoveryFromServer.spendTxHash,
            amountStroops: recoveryFromServer.amountStroops,
            relayG: "",
            envelope: recoveryFromServer.envelope,
            amountPhp: recoveryFromServer.amountPhp,
            amountToken: recoveryFromServer.amountToken,
            bankCode: recoveryFromServer.bankCode,
            accountName: recoveryFromServer.accountName,
            accountNumber: recoveryFromServer.accountNumber,
          }
        : null);
    if (!source) return;
    setLocalPhase("signing");
    try {
      // Always call initiate during recovery, even if the snapshot
      // already has a relayG. Two reasons:
      //  1. initiate sets the hook's identifierRef — confirmSigned
      //     depends on it later, and would throw "No withdrawal in
      //     flight" if we skipped this call.
      //  2. /fiat/withdraw is idempotent on `identifier` now: when the
      //     row already exists it short-circuits the insert and just
      //     returns the same relayG, so this costs one Supabase select
      //     and avoids creating an orphan pending row.
      const init = await initiate({
        envelope: source.envelope,
        amountToken: source.amountToken,
        amountPhp: source.amountPhp,
        bankCode: source.bankCode,
        accountName: source.accountName,
        accountNumber: source.accountNumber,
        identifier: source.identifier,
      });
      const relayG = source.relayG || init.relayG;
      const { spendTxHash, forwardTxHash } = await retryForward({
        spendTxHash: source.spendTxHash,
        amountStroops: BigInt(source.amountStroops),
        relayG,
      });
      await confirmSigned({ spendTxHash, forwardTxHash });
      clearCashoutRecovery();
    } catch {
      setLocalPhase("recovery_prompt");
    }
  };

  const handleDiscardRecovery = () => {
    clearCashoutRecovery();
    setRecoverySnapshot(null);
    setRecoveryFromServer(null);
    setLocalPhase(bank ? "input" : "loading_bank");
  };

  const error = pdaxError ?? signError;

  return (
    <Sheet onClose={handleClose} draggable={false} ariaLabel="Cash out">
        {/* See PdaxDepositModal for the rationale on key={phase} + the
            entry animation classes. */}
        <div
          key={phase}
          className="animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
        {phase === "loading_bank" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title="Loading…"
          />
        ) : null}

        {phase === "register_bank" ? (
          <RegisterBankStep
            onCancel={handleClose}
            onSaved={(b) => {
              setBank(b);
              setLocalPhase("input");
            }}
          />
        ) : null}

        {phase === "recovery_prompt" ? (
          <RecoveryPromptStep
            envelopeNames={state.envelope_names}
            envelope={
              recoverySnapshot?.envelope ??
              recoveryFromServer?.envelope ??
              "Groceries"
            }
            amountPhp={
              recoverySnapshot?.amountPhp ?? recoveryFromServer?.amountPhp ?? 0
            }
            bankName={
              BANKS.find(
                (b) =>
                  b.code ===
                  (recoverySnapshot?.bankCode ?? recoveryFromServer?.bankCode),
              )?.name ?? "your bank"
            }
            error={error}
            pending={pdaxPending || signPending}
            onResume={() => void handleResumeRecovery()}
            onDiscard={handleDiscardRecovery}
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
            onCancel={handleClose}
            onConfirm={() => void handleConfirm()}
            pending={pdaxPending || signPending}
            error={error}
          />
        ) : null}

        {phase === "signing" ? (
          <SigningStep step={signStep} />
        ) : null}

        {phase === "awaiting" && row ? (
          <AwaitingStep status={row.status} />
        ) : null}

        {phase === "done" && row ? (
          <CenteredCopy
            icon={<Check size={28} strokeWidth={2.5} />}
            title="Sent to your bank"
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
            title="Cashout couldn't complete"
            body={
              row.failure_reason
                ? `${row.failure_reason}. The ₱${Number(row.amount_php ?? 0).toLocaleString("en-PH")} is still at PDAX. Contact support to recover, or retry from your wallet.`
                : "The cashout didn't complete. Your funds are recoverable. Contact support if they're stuck at PDAX."
            }
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

function RecoveryPromptStep({
  envelope,
  envelopeNames,
  amountPhp,
  bankName,
  error,
  pending,
  onResume,
  onDiscard,
}: {
  envelope: EnvelopeName;
  envelopeNames: string[];
  amountPhp: number;
  bankName: string;
  error: string | null;
  pending: boolean;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const envLabel = displayEnvelopeName(envelope, envelopeNames);
  return (
    <>
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
        <h2 style={{ margin: 0 }}>Finish your cashout?</h2>
      </div>
      <p className="sub">
        Your previous cashout of{" "}
        <b style={{ color: "var(--text-1)" }}>
          ₱{amountPhp.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
        </b>{" "}
        from {envLabel} to {bankName} debited the envelope on chain but the
        second confirmation didn&apos;t go through. Your XLM is still in
        your wallet. Tap continue to resume the cashout with one passkey
        prompt. No second debit.
      </p>

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
          onClick={onDiscard}
          disabled={pending}
        >
          Not now
        </button>
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={onResume}
          disabled={pending}
          style={pending ? { opacity: 0.5 } : {}}
        >
          {pending ? "Resuming…" : "Continue cashout"}
        </button>
      </div>
    </>
  );
}

function SigningStep({
  step,
}: {
  step: "idle" | "spending" | "forwarding";
}) {
  const title =
    step === "forwarding"
      ? "Forwarding to PDAX…"
      : "Withdrawing from envelope…";
  return (
    <CenteredCopy
      icon={<Loader2 size={28} className="animate-spin" />}
      title={title}
    />
  );
}

function AwaitingStep({
  status,
}: {
  status: WithdrawStatus;
}) {
  return (
    <CenteredCopy
      icon={<Loader2 size={28} className="animate-spin" />}
      title={STATUS_LABELS[status]}
    />
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

