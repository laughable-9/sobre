"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Loader2 } from "lucide-react";

import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { STATUS_LABELS } from "@/components/sobre/PdaxWithdrawModal";
import { Sheet } from "@/components/sobre/Sheet";
import { useCashoutSignatures } from "@/hooks/useCashoutSignatures";
import {
  clearCashoutRecovery,
  readCashoutRecovery,
  type CashoutRecoverySnapshot,
} from "@/lib/cashoutRecovery";
import { usePdaxWithdraw } from "@/hooks/usePdaxWithdraw";
import { usePollStatus } from "@/hooks/usePollStatus";
import { useTokenRate } from "@/hooks/useTokenRate";
import { BANKS, bankName } from "@/lib/banks";
import {
  PDAX_INSTAPAY_FEE_PHP,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
} from "@/lib/config";
import { useCurrency } from "@/lib/currency";

/**
 * Sub-account PDAX cashout. Mirrors PdaxWithdrawModal but tailored to the
 * supplementary-card flow:
 *   - No envelope picker (source is the sub's on-chain balance).
 *   - Caller's spend leg is `spend_from_subaccount` instead of `spend`.
 *   - First cashout collects bank details inline; the row goes into
 *     member_bank_details keyed off the sub's own wallets.id (one bank
 *     per wallet — same table the member modal uses, just from a
 *     different wallet).
 *   - Recovery snapshot mirrors the member cashout: leg-1 landing
 *     writes a `kind: "subaccount"` snapshot; if the tab dies before
 *     leg-2, next mount reads the snapshot and offers Resume.
 *
 * Backend pipeline is identical once the row lands at `spent`:
 *   pending → spent → transferred → converted → processing → paid
 */

interface Props {
  userAddress: string;
  contractId: string;
  subaccountId: string;
  /** Spendable balance on-chain in stroops. The modal caps the typed
   *  amount at this. Ignored when resumeIdentifier is set (the row's
   *  amount_usdc is what matters at that point). */
  balanceStroops: bigint;
  /** True when this sub-account is locked on-chain. The modal short-
   *  circuits to a locked empty state instead of the input phase — a
   *  cashout would revert anyway, so we head that off with an
   *  explanation. */
  locked?: boolean;
  /** When set, hydrate from an existing pdax_withdrawals row instead of
   *  starting a fresh cashout. Used by the PENDING strip in SubAccountView
   *  to let the user reopen a mid-pipeline cashout (modal closed before
   *  paid) and watch it settle. */
  resumeIdentifier?: string;
  onClose: () => void;
  onSuccess: (php: number) => void;
}

type Phase =
  | "loading_bank"
  | "bank_setup"
  | "input"
  | "signing"
  | "recovery_prompt"
  | "awaiting"
  | "success"
  | "error";

interface BankRecord {
  bank_code: string;
  account_name: string;
  account_number: string;
}

export function SubAccountCashoutModal({
  userAddress,
  contractId,
  subaccountId,
  balanceStroops,
  locked = false,
  resumeIdentifier,
  onClose,
  onSuccess,
}: Props) {
  // When resuming, skip the bank-setup + amount input phases entirely —
  // we're just watching a mid-pipeline row settle.
  const [phase, setPhase] = useState<Phase>(
    resumeIdentifier ? "awaiting" : "loading_bank",
  );
  const [bank, setBank] = useState<BankRecord | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [bankSetup, setBankSetup] = useState<BankRecord>({
    bank_code: BANKS[0]!.code,
    account_name: "",
    account_number: "",
  });
  const [bankSaving, setBankSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const { phpPerToken } = useTokenRate();
  const {
    initiate,
    confirmSigned,
    row,
    pending: pdaxPending,
    error: pdaxError,
  } = usePdaxWithdraw(contractId, resumeIdentifier);
  const {
    signSubaccountAndForward,
    retryForward,
    pending: signPending,
    error: signError,
    step: signStep,
  } = useCashoutSignatures(userAddress, contractId);
  // Recovery snapshot. Set when a partial-cashout leftover matches
  // this contract + sub-account. Modal opens on recovery_prompt if
  // populated.
  const [recoverySnapshot, setRecoverySnapshot] =
    useState<CashoutRecoverySnapshot | null>(null);

  // Recovery scan + bank load, sequenced in ONE effect so the modal
  // can't flip to phase="input" and let the user tap Confirm before
  // the recovery scan has had a chance to override with
  // "recovery_prompt". Previously these were two parallel effects and
  // a bank-first response fired a second spend_from_subaccount on a
  // rapid Confirm.
  useEffect(() => {
    if (resumeIdentifier) return;
    let cancelled = false;
    void (async () => {
      // Phase A: check the local snapshot.
      const local = readCashoutRecovery();
      if (
        local &&
        local.kind === "subaccount" &&
        local.contractId === contractId &&
        local.subaccountId === subaccountId
      ) {
        if (cancelled) return;
        setRecoverySnapshot(local);
        setPhase("recovery_prompt");
        return;
      }
      // Phase B: server-side recoverable scan for cross-tab/cross-device.
      try {
        const res = await fetch(
          `/api/pdax/subaccount/cashouts/recoverable?contract_id=${encodeURIComponent(contractId)}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as {
            recoverable: Array<{
              identifier: string;
              subaccountId: string;
              amountStroops: string;
              amountPhp: number;
              amountToken: number;
              beneficiary_bank_code: string;
              beneficiary_account_name: string;
              beneficiary_account_number: string;
              spendTxHash: string;
            }>;
          };
          const r = (json.recoverable ?? []).find(
            (x) => x.subaccountId === subaccountId,
          );
          if (r) {
            if (cancelled) return;
            setRecoverySnapshot({
              kind: "subaccount",
              identifier: r.identifier,
              contractId,
              spendTxHash: r.spendTxHash,
              amountStroops: r.amountStroops,
              relayG: "",
              envelope: null,
              subaccountId: r.subaccountId,
              amountPhp: r.amountPhp,
              amountToken: r.amountToken,
              bankCode: r.beneficiary_bank_code,
              accountName: r.beneficiary_account_name,
              accountNumber: r.beneficiary_account_number,
              savedAt: Date.now(),
            });
            setPhase("recovery_prompt");
            return;
          }
        }
      } catch {
        // No server fallback available — fall through to bank load.
      }
      // Phase C: only NOW load the bank. If we route to input here,
      // there's no pending recovery that could override us into
      // recovery_prompt after a Confirm tap.
      try {
        const bankRes = await fetch("/api/member/bank");
        if (cancelled) return;
        if (!bankRes.ok) {
          setErrMsg("Couldn't read your bank details. Try again.");
          setPhase("error");
          return;
        }
        const { bank: b } = (await bankRes.json()) as {
          bank: BankRecord | null;
        };
        if (b) {
          setBank(b);
          setPhase("input");
        } else {
          setPhase("bank_setup");
        }
      } catch {
        if (cancelled) return;
        setErrMsg("Couldn't read your bank details. Try again.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeIdentifier, contractId, subaccountId]);

  // Drive the server-side pipeline forward while we're in the awaiting
  // phase. usePollStatus fires the poll-status route on a cadence; Realtime
  // relays the row updates back to usePdaxWithdraw which re-renders this.
  usePollStatus(
    row?.identifier
      ? `/api/pdax/withdrawals/${row.identifier}/poll-status`
      : null,
    phase === "awaiting",
  );

  // Mirror onSuccess into a ref so the row-watcher effect doesn't need it
  // in deps. Without this, an inline-arrow onSuccess in the parent (the
  // typical pattern) re-creates the function every render, the effect
  // re-runs after status='paid', and onSuccess (with its toast + refresh)
  // fires multiple times.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  // Guard against re-firing onSuccess if the row stays at 'paid' across
  // re-renders (Supabase row identity changes, even when the value
  // doesn't).
  const successFiredRef = useRef(false);

  // Watch the row through the backend pipeline. External-sync effect —
  // the row prop is driven by realtime updates, and we fire onSuccess
  // exactly once on the terminal transition.
  useEffect(() => {
    if (!row) return;
    if (row.status === "paid") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("success");
      if (!successFiredRef.current) {
        successFiredRef.current = true;
        onSuccessRef.current(row.amount_php ?? 0);
      }
    } else if (row.status === "failed") {
       
      setErrMsg(row.failure_reason ?? "Cashout failed.");
       
      setPhase("error");
    } else if (
      row.status === "spent" ||
      row.status === "transferred" ||
      row.status === "converted" ||
      row.status === "processing"
    ) {
       
      setPhase("awaiting");
    }
  }, [row]);

  // Use the live PDAX rate (when available) consistently for both the
  // balance display AND the cashout conversion. Mixing the two rates lets
  // a user type an amount that passes the <= balancePhp check but produces
  // amountStroops > balanceStroops, which spend_from_subaccount then
  // rejects with InsufficientBalance.
  const rate = phpPerToken ?? PHP_PER_USDC;
  const { currency } = useCurrency();
  const symbol = currency === "USD" ? "$" : "₱";
  const balanceToken = Number(balanceStroops) / STROOPS_PER_USDC;
  const balancePhp = balanceToken * rate;
  const balanceInCurrency = currency === "USD" ? balanceToken : balancePhp;
  const balanceLocale = currency === "USD" ? "en-US" : "en-PH";
  // Fee handling (Option 2): the amount the user types is what lands at
  // the bank. PDAX's InstaPay service fee is added on top and the total
  // has to be covered by the on-chain USDC spend, so their bank payout
  // stays exactly what they asked for.
  const parsedAmount = Number(amountStr);
  const payoutPhp =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? currency === "USD"
        ? parsedAmount * rate
        : parsedAmount
      : 0;
  const feePhp = PDAX_INSTAPAY_FEE_PHP;
  const totalPhp = payoutPhp + feePhp;
  // On-chain spend covers the total (payout + fee) so PDAX's fee comes
  // out of the USDC the user just sold. Bank leg still receives payoutPhp
  // exactly. amountPhp stored on the row stays "what lands in the bank"
  // — the fee is tracked in service_fee_php.
  const amountToken = totalPhp / rate;
  const amountPhp = payoutPhp;
  const totalInCurrency = currency === "USD" ? totalPhp / rate : totalPhp;
  const feeInCurrency = currency === "USD" ? feePhp / rate : feePhp;
  const validAmount = amountToken > 0 && amountToken <= balanceToken;

  const submitBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !bankSetup.account_name.trim() ||
      !bankSetup.account_number.trim()
    ) {
      return;
    }
    setBankSaving(true);
    setErrMsg(null);
    try {
      const res = await fetch("/api/member/bank", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bankSetup),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setBank(bankSetup);
      setPhase("input");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBankSaving(false);
    }
  };

  const submitCashout = async () => {
    if (!validAmount || !bank) return;
    setErrMsg(null);
    setPhase("signing");
    let amountStroops = BigInt(Math.round(amountToken * STROOPS_PER_USDC));
    // Final guard against sub-peso rounding pushing us above the on-chain
    // balance. Cap at the holder's actual stroops — the cashout PHP value
    // stays as the user typed it; PDAX settles at the trade leg's rate.
    if (amountStroops > balanceStroops) amountStroops = balanceStroops;
    try {
      const { identifier, relayG } = await initiate({
        subaccountId,
        amountToken,
        amountPhp,
        bankCode: bank.bank_code,
        accountName: bank.account_name,
        accountNumber: bank.account_number,
      });
      const { spendTxHash, forwardTxHash } = await signSubaccountAndForward({
        identifier,
        subaccountId,
        amountStroops,
        amountPhp,
        amountToken,
        relayG,
        bankCode: bank.bank_code,
        accountName: bank.account_name,
        accountNumber: bank.account_number,
      });
      await confirmSigned({ spendTxHash, forwardTxHash });
      setPhase("awaiting");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      // If signSubaccountAndForward saved a snapshot between the two
      // legs (spend landed, transfer didn't), route to recovery_prompt
      // rather than the generic error. A retry from `input` would fire
      // a SECOND spend and double-debit the sub-account.
      const snap = readCashoutRecovery();
      if (
        snap &&
        snap.kind === "subaccount" &&
        snap.contractId === contractId &&
        snap.subaccountId === subaccountId
      ) {
        setRecoverySnapshot(snap);
        setPhase("recovery_prompt");
        return;
      }
      setPhase("error");
    }
  };

  // Resume path: leg-1 already landed on chain (we have its hash in the
  // snapshot); skip signing another spend and just re-run the SAC
  // transfer + /confirmed with the same identifier. Firing a fresh
  // spend here would over-debit the sub-account balance.
  const resumeFromSnapshot = async () => {
    if (!recoverySnapshot) return;
    setErrMsg(null);
    setPhase("signing");
    try {
      // initiate is idempotent on identifier: an existing row returns
      // the same relayG. Necessary because usePdaxWithdraw.confirmSigned
      // needs identifierRef populated to know which row to advance.
      const init = await initiate({
        subaccountId,
        amountToken: recoverySnapshot.amountToken,
        amountPhp: recoverySnapshot.amountPhp,
        bankCode: recoverySnapshot.bankCode,
        accountName: recoverySnapshot.accountName,
        accountNumber: recoverySnapshot.accountNumber,
        identifier: recoverySnapshot.identifier,
      });
      const relayG = recoverySnapshot.relayG || init.relayG;
      const { spendTxHash, forwardTxHash } = await retryForward({
        spendTxHash: recoverySnapshot.spendTxHash,
        amountStroops: BigInt(recoverySnapshot.amountStroops),
        relayG,
      });
      await confirmSigned({ spendTxHash, forwardTxHash });
      clearCashoutRecovery();
      setRecoverySnapshot(null);
      setPhase("awaiting");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setPhase("recovery_prompt");
    }
  };

  const discardRecovery = () => {
    clearCashoutRecovery();
    setRecoverySnapshot(null);
    setPhase(bank ? "input" : "loading_bank");
  };

  const close = () => {
    // Allow close at any phase. If the row is mid-pipeline it carries on
    // server-side; the activity feed surfaces it as pending.
    onClose();
  };

  // Empty-state short-circuit: locked account OR zero balance. Skip the
  // regular phase machinery — a fresh cashout attempt would revert
  // on-chain or fail validation anyway, so tell the user why plainly.
  // The `resumeIdentifier` path bypasses this because we're just
  // watching a mid-pipeline row settle, not starting a new cashout.
  if (!resumeIdentifier && (locked || balanceStroops <= 0n)) {
    return (
      <Sheet onClose={close} ariaLabel="Cash out">
        <h2>{locked ? "Account locked" : "Nothing to cash out yet"}</h2>
        <p className="sub">
          {locked
            ? "Ask an admin to unlock this account before cashing out."
            : "Money will appear here once an admin tops you up."}
        </p>
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={close}
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={close} ariaLabel="Cash out">
        {phase === "loading_bank" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title="Loading…"
          />
        ) : null}

        {phase === "bank_setup" ? (
          <>
            <h2>Set up your bank</h2>
            <p className="sub">
              We&apos;ll send your cashouts here.
            </p>
            <form onSubmit={submitBank}>
              <div className="sobre-input-group">
                <label>Bank</label>
                <div className="flex gap-2 mt-1">
                  {BANKS.map((b) => {
                    const active = bankSetup.bank_code === b.code;
                    return (
                      <button
                        key={b.code}
                        type="button"
                        onClick={() =>
                          setBankSetup((cur) => ({
                            ...cur,
                            bank_code: b.code,
                          }))
                        }
                        className="flex-1 p-3 rounded-[10px] text-left"
                        style={{
                          border: active
                            ? "1.5px solid var(--sobre-accent)"
                            : "1px solid var(--border)",
                          background: active
                            ? "var(--accent-soft)"
                            : "var(--surface-alt)",
                          fontWeight: 600,
                          fontSize: 13,
                          color: active
                            ? "var(--sobre-accent)"
                            : "var(--text-1)",
                        }}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sobre-input-group">
                <label htmlFor="sub-bank-name">Account name</label>
                <div className="sobre-input-wrap">
                  <input
                    id="sub-bank-name"
                    className="sobre-input"
                    type="text"
                    value={bankSetup.account_name}
                    onChange={(e) =>
                      setBankSetup((cur) => ({
                        ...cur,
                        account_name: e.target.value,
                      }))
                    }
                    disabled={bankSaving}
                    maxLength={80}
                  />
                </div>
              </div>
              <div className="sobre-input-group">
                <label htmlFor="sub-bank-num">Account number</label>
                <div className="sobre-input-wrap">
                  <input
                    id="sub-bank-num"
                    className="sobre-input tabular"
                    type="text"
                    inputMode="numeric"
                    value={bankSetup.account_number}
                    onChange={(e) =>
                      setBankSetup((cur) => ({
                        ...cur,
                        account_number: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                    disabled={bankSaving}
                    maxLength={20}
                  />
                </div>
              </div>
              {errMsg ? (
                <p
                  className="text-xs break-all mb-3"
                  style={{ color: "var(--sobre-danger)" }}
                >
                  {errMsg}
                </p>
              ) : null}
              <div className="sobre-modal-actions">
                <button
                  type="button"
                  className="sobre-btn sobre-btn-soft"
                  onClick={close}
                  disabled={bankSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sobre-btn sobre-btn-primary"
                  disabled={
                    bankSaving ||
                    !bankSetup.account_name.trim() ||
                    !bankSetup.account_number.trim()
                  }
                  style={{ opacity: bankSaving ? 0.6 : 1 }}
                >
                  {bankSaving ? "Saving…" : "Save bank"}
                </button>
              </div>
            </form>
          </>
        ) : null}

        {phase === "input" && bank ? (
          <>
            <h2>Cash out to your bank</h2>

            <div className="sobre-input-group">
              <label htmlFor="sub-cashout-amt">
                Amount in {currency === "USD" ? "dollars" : "pesos"}
              </label>
              <div className="sobre-input-wrap">
                <span className="prefix">{symbol}</span>
                <input
                  id="sub-cashout-amt"
                  className="sobre-input has-prefix tabular"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step={currency === "USD" ? "0.01" : "1"}
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  disabled={pdaxPending || signPending}
                  autoFocus
                />
              </div>
              <div
                className="mt-2 text-[12px]"
                style={{ color: "var(--text-3)" }}
              >
                Available: {symbol}
                {balanceInCurrency.toLocaleString(balanceLocale, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>

            {payoutPhp > 0 ? (
              <div
                className="rounded-[10px] px-3 py-2 mb-4 text-[12px]"
                style={{
                  background: "var(--surface-alt)",
                  border: "1px solid var(--border)",
                  color: "var(--text-2)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span>InstaPay fee</span>
                  <span className="tabular">
                    {symbol}
                    {feeInCurrency.toLocaleString(balanceLocale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between mt-1 pt-2"
                  style={{
                    borderTop: "1px dashed var(--border)",
                    color: "var(--text-1)",
                    fontWeight: 600,
                  }}
                >
                  <span>Total deducted</span>
                  <span className="tabular">
                    {symbol}
                    {totalInCurrency.toLocaleString(balanceLocale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
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
                  <div
                    className="text-[13px] font-medium"
                    style={{ color: "var(--text-1)" }}
                  >
                    {bank.account_name}
                  </div>
                  <div
                    className="text-[11px] tabular"
                    style={{ color: "var(--text-3)" }}
                  >
                    {bankName(bank.bank_code)} · ••
                    {bank.account_number.slice(-4)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPhase("bank_setup")}
                disabled={pdaxPending || signPending}
                className="text-[12px]"
                style={{
                  color: "var(--sobre-accent)",
                  background: "transparent",
                  border: "none",
                  cursor:
                    pdaxPending || signPending ? "not-allowed" : "pointer",
                }}
              >
                Change
              </button>
            </div>

            {errMsg ? (
              <p
                className="text-xs break-all mb-3"
                style={{ color: "var(--sobre-danger)" }}
              >
                {errMsg}
              </p>
            ) : null}

            <div className="sobre-modal-actions">
              <button
                type="button"
                className="sobre-btn sobre-btn-soft"
                onClick={close}
                disabled={pdaxPending || signPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sobre-btn sobre-btn-primary"
                disabled={!validAmount || pdaxPending || signPending}
                onClick={() => void submitCashout()}
                style={{
                  opacity:
                    !validAmount || pdaxPending || signPending ? 0.55 : 1,
                }}
              >
                {pdaxPending || signPending
                  ? "Preparing…"
                  : "Confirm cashout"}
              </button>
            </div>
          </>
        ) : null}

        {phase === "recovery_prompt" && recoverySnapshot ? (
          <>
            <h2>Finish your cashout?</h2>
            <p className="sub">
              A ₱
              {recoverySnapshot.amountPhp.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              cashout landed on chain but didn&apos;t finish. Tap Resume
              to send it to{" "}
              <b>{bankName(recoverySnapshot.bankCode)}</b>. No new
              charges — you already signed the on-chain part.
            </p>
            {errMsg ? (
              <p
                className="mt-2 text-[12px]"
                style={{ color: "var(--sobre-danger)" }}
              >
                {errMsg}
              </p>
            ) : null}
            <div className="sobre-modal-actions">
              <button
                type="button"
                className="sobre-btn sobre-btn-soft"
                onClick={discardRecovery}
              >
                Discard
              </button>
              <button
                type="button"
                className="sobre-btn sobre-btn-primary"
                onClick={() => void resumeFromSnapshot()}
              >
                Resume
              </button>
            </div>
          </>
        ) : null}

        {phase === "signing" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title={
              signStep === "spending"
                ? "Confirm in your passkey (1 of 2)"
                : signStep === "forwarding"
                  ? "Confirm in your passkey (2 of 2)"
                  : "Preparing…"
            }
          />
        ) : null}

        {phase === "awaiting" ? (
          <CenteredCopy
            icon={<Loader2 size={28} className="animate-spin" />}
            title={
              row?.status ? STATUS_LABELS[row.status] : "Preparing…"
            }
          />
        ) : null}

        {phase === "success" ? (
          <>
            <h2>Cashed out</h2>
            <p className="sub">
              ₱
              {(row?.amount_php ?? amountPhp).toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              landed in your bank.
            </p>
            <div className="sobre-modal-actions">
              <button
                type="button"
                className="sobre-btn sobre-btn-primary"
                onClick={close}
              >
                Done
              </button>
            </div>
          </>
        ) : null}

        {phase === "error" ? (
          <ErrorPhase
            reason={
              errMsg ?? pdaxError ?? signError ?? "Cashout couldn't complete."
            }
            onClose={close}
          />
        ) : null}
    </Sheet>
  );
}

/** Error phase for the cashout modal. Renders a short friendly title,
 *  the sanitized reason as a scrollable copyable block (matches the
 *  activity feed's FailureRow sheet so support screenshots have the
 *  same shape), and a Copy button so a user can send it to support
 *  without hand-transcribing a HostError. */
function ErrorPhase({
  reason,
  onClose,
}: {
  reason: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h2>Something went wrong</h2>
      <p className="sub">
        Copy this and send it to support if you need help.
      </p>
      <pre
        className="tabular"
        style={{
          maxHeight: "45vh",
          overflow: "auto",
          padding: "12px 14px",
          borderRadius: 10,
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: "0 0 12px",
        }}
      >
        {reason}
      </pre>
      <div className="sobre-modal-actions">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(reason);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="sobre-btn sobre-btn-soft"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="sobre-btn sobre-btn-primary"
        >
          Close
        </button>
      </div>
    </>
  );
}
