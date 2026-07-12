"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Sheet } from "@/components/sobre/Sheet";
import { useCashoutSignatures } from "@/hooks/useCashoutSignatures";
import { usePdaxWithdraw } from "@/hooks/usePdaxWithdraw";
import { usePollStatus } from "@/hooks/usePollStatus";
import { useTokenRate } from "@/hooks/useTokenRate";
import { BANKS, bankName } from "@/lib/banks";
import {
  PHP_PER_USDC,
  STROOPS_PER_USDC,
} from "@/lib/config";

/**
 * Sub-account PDAX cashout. Mirrors PdaxWithdrawModal but tailored to the
 * supplementary-card flow:
 *   - No envelope picker (source is the sub's on-chain balance).
 *   - Caller's spend leg is `spend_from_subaccount` instead of `spend`.
 *   - First cashout collects bank details inline; the row goes into
 *     member_bank_details keyed off the sub's own wallets.id (one bank
 *     per wallet — same table the member modal uses, just from a
 *     different wallet).
 *   - No localStorage recovery snapshot (deferred per feature-backlog).
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
    pending: signPending,
    error: signError,
    step: signStep,
  } = useCashoutSignatures(userAddress, contractId);

  // Load bank on mount — skipped when resuming an existing cashout (we
  // jump straight to the awaiting phase to poll the row).
  useEffect(() => {
    if (resumeIdentifier) return;
    let cancelled = false;
    void fetch("/api/member/bank")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setErrMsg("Couldn't read your bank details. Try again.");
          setPhase("error");
          return;
        }
        const { bank: b } = (await res.json()) as {
          bank: BankRecord | null;
        };
        if (b) {
          setBank(b);
          setPhase("input");
        } else {
          setPhase("bank_setup");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setErrMsg("Couldn't read your bank details. Try again.");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [resumeIdentifier]);

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

  // Watch the row through the backend pipeline.
  useEffect(() => {
    if (!row) return;
    if (row.status === "paid") {
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
  const balancePhp = (Number(balanceStroops) / STROOPS_PER_USDC) * rate;
  const parsedPhp = Number(amountStr);
  const validAmount =
    Number.isFinite(parsedPhp) && parsedPhp > 0 && parsedPhp <= balancePhp;

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
    const amountToken = parsedPhp / rate;
    let amountStroops = BigInt(Math.round(amountToken * STROOPS_PER_USDC));
    // Final guard against sub-peso rounding pushing us above the on-chain
    // balance. Cap at the holder's actual stroops — the cashout PHP value
    // stays as the user typed it; PDAX settles at the trade leg's rate.
    if (amountStroops > balanceStroops) amountStroops = balanceStroops;
    try {
      const { relayG } = await initiate({
        subaccountId,
        amountToken,
        amountPhp: parsedPhp,
        bankCode: bank.bank_code,
        accountName: bank.account_name,
        accountNumber: bank.account_number,
      });
      const { spendTxHash, forwardTxHash } = await signSubaccountAndForward({
        amountStroops,
        relayG,
      });
      await confirmSigned({ spendTxHash, forwardTxHash });
      setPhase("awaiting");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
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
          <CenteredSpinner label="Loading…" />
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
            <h2>Cash out</h2>
            <p className="sub">
              Lands in your {bankName(bank.bank_code)} account · ••
              {bank.account_number.slice(-4)}
            </p>
            <div className="sobre-input-group">
              <label htmlFor="sub-cashout-amt">Amount in pesos</label>
              <div className="sobre-input-wrap">
                <span className="prefix">₱</span>
                <input
                  id="sub-cashout-amt"
                  className="sobre-input has-prefix tabular"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  autoFocus
                />
              </div>
              <div
                style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}
              >
                You have ₱
                {balancePhp.toLocaleString("en-PH", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                available.
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
              >
                Cancel
              </button>
              <button
                type="button"
                className="sobre-btn sobre-btn-primary"
                disabled={!validAmount || pdaxPending || signPending}
                onClick={() => void submitCashout()}
                style={{
                  opacity: !validAmount || pdaxPending || signPending ? 0.55 : 1,
                }}
              >
                Cash out ₱
                {validAmount ? parsedPhp.toLocaleString("en-PH") : "0"}
              </button>
            </div>
          </>
        ) : null}

        {phase === "signing" ? (
          <CenteredSpinner
            label={
              signStep === "spending"
                ? "Confirm in your passkey (1 of 2)"
                : signStep === "forwarding"
                  ? "Confirm in your passkey (2 of 2)"
                  : "Preparing…"
            }
          />
        ) : null}

        {phase === "awaiting" ? (
          <CenteredSpinner
            label={
              row?.status === "spent"
                ? "Sending to PDAX…"
                : row?.status === "transferred"
                  ? "Selling for pesos…"
                  : row?.status === "converted"
                    ? "Sending to your bank…"
                    : row?.status === "processing"
                      ? "Waiting on your bank…"
                      : "Working on it…"
            }
          />
        ) : null}

        {phase === "success" ? (
          <>
            <h2>Cashed out</h2>
            <p className="sub">
              ₱
              {(row?.amount_php ?? parsedPhp).toLocaleString("en-PH", {
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
          <>
            <h2>Something went wrong</h2>
            <p className="sub">
              {errMsg ?? pdaxError ?? signError ?? "Cashout couldn't complete."}
            </p>
            <div className="sobre-modal-actions">
              <button
                type="button"
                className="sobre-btn sobre-btn-soft"
                onClick={close}
              >
                Close
              </button>
            </div>
          </>
        ) : null}
    </Sheet>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "24px 0",
      }}
    >
      <Loader2
        size={28}
        className="animate-spin"
        style={{ color: "var(--sobre-accent)" }}
      />
      <div style={{ fontSize: 14, color: "var(--text-2)", textAlign: "center" }}>
        {label}
      </div>
    </div>
  );
}
