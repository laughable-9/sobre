"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Sheet } from "@/components/sobre/Sheet";
import { useDeposit } from "@/hooks/useDeposit";
import { useTokenRate } from "@/hooks/useTokenRate";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PAYMENT_TOKEN_LABEL,
  STROOPS_PER_TOKEN,
  displayEnvelopeName,
} from "@/lib/config";
import { readTokenBalance } from "@/lib/contract";
import { shortenAddress } from "@/lib/format";

/** How often the receive section re-checks the wallet's on-chain USDC
 *  balance while the modal is open, so a user who just sent funds from
 *  an exchange or another wallet sees the balance land without closing
 *  and reopening the modal. */
const BALANCE_POLL_MS = 4000;

const QUICK_PHP = [100, 500, 1000, 5000];
const QUICK_USDC = [1, 5, 10, 50];

type Unit = "PHP" | "USDC";

export function DepositModal({
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
  /** Called after the tx lands on chain with the actual amount sent. */
  onSuccess: (info: { usdc: number; stroops: bigint; php: number }) => void;
}) {
  const [unit, setUnit] = useState<Unit>("PHP");
  const [amountStr, setAmountStr] = useState("500");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { deposit, pending, error } = useDeposit(userAddress, contractId);
  // Live rate, same source the withdraw modals read, so the peso figures
  // here match the rest of the app instead of a stale hardcoded constant.
  const { phpPerToken } = useTokenRate();

  const [balanceStroops, setBalanceStroops] = useState<bigint | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);

  const amount = Number(amountStr);
  const valid = isFinite(amount) && amount > 0;
  const usdc = unit === "USDC" ? amount : amount / phpPerToken;
  const php = unit === "PHP" ? amount : amount * phpPerToken;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Polls the wallet's own USDC balance so a user who just sent funds in
  // sees the number move without leaving the modal. Stops on unmount.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const balance = await readTokenBalance(userAddress);
        if (!cancelled) setBalanceStroops(balance);
      } catch {
        // RPC blip; the next tick retries.
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userAddress]);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(userAddress);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);
    } catch {
      // clipboard refused; ignore
    }
  };

  const balanceUsdc =
    balanceStroops !== null ? Number(balanceStroops) / STROOPS_PER_TOKEN : null;
  const balanceLabel =
    balanceUsdc === null
      ? "…"
      : unit === "PHP"
        ? `₱${(balanceUsdc * phpPerToken).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : `${balanceUsdc.toFixed(4)} ${PAYMENT_TOKEN_LABEL}`;

  // Convert the typed amount when toggling units so the underlying USDC
  // value stays the same; e.g. ₱500 toggled to USDC becomes 31.25. PHP keeps
  // 2 decimals so sub-peso USDC amounts survive a PHP → USDC → PHP round-trip
  // instead of getting quantised to whole pesos.
  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    const converted =
      next === "USDC" ? amount / phpPerToken : amount * phpPerToken;
    setAmountStr(
      Number.isFinite(converted) ? converted.toFixed(next === "USDC" ? 4 : 2) : "",
    );
    setUnit(next);
  };

  const handleSubmit = async () => {
    if (!valid) return;
    const stroops = BigInt(Math.round(usdc * STROOPS_PER_TOKEN));
    try {
      await deposit(stroops, state.percents);
      onSuccess({ usdc, stroops, php });
    } catch {
      // surfaces via the hook's error state
    }
  };

  const rateLabel = phpPerToken.toLocaleString("en-PH", {
    maximumFractionDigits: 2,
  });
  const quick = unit === "PHP" ? QUICK_PHP : QUICK_USDC;
  const fmtQuick = (q: number) =>
    unit === "PHP" ? `₱${q.toLocaleString()}` : `${q} ${PAYMENT_TOKEN_LABEL}`;

  return (
    <Sheet onClose={onClose} ariaLabel="Add a remittance">
        <h2>Add a remittance</h2>
        <p className="sub">
          Send {PAYMENT_TOKEN_LABEL} to your Sobre address below, then split
          it into your envelopes.
        </p>

        <p
          style={{
            marginTop: 12,
            marginBottom: 16,
            fontSize: 13,
            color: "var(--sobre-text-3)",
          }}
        >
          Bank cash in is unavailable for now.
        </p>

        <div className="sobre-input-group">
          <div className="sobre-label mb-2">Your Sobre wallet address</div>
          <div
            className="flex items-center gap-3 rounded-[10px] p-3"
            style={{ background: "var(--surface-alt)", border: "1px solid var(--border)" }}
          >
            <span
              className="tabular flex-1 text-[13px]"
              style={{ color: "var(--text-1)" }}
            >
              {shortenAddress(userAddress)}
            </span>
            <button
              type="button"
              className="sobre-btn sobre-btn-soft"
              style={{ padding: "7px 12px", fontSize: 13 }}
              onClick={() => void copyAddress()}
            >
              {addressCopied ? (
                <>
                  <Check size={13} strokeWidth={2.5} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={13} strokeWidth={2} />
                  Copy
                </>
              )}
            </button>
          </div>
          <div className="mt-2 text-[12px]" style={{ color: "var(--text-3)" }}>
            Send {PAYMENT_TOKEN_LABEL} on the Stellar network to this
            address.
          </div>
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span style={{ color: "var(--text-3)" }}>Wallet balance</span>
            <span
              className="tabular font-semibold"
              style={{ color: "var(--text-1)" }}
            >
              {balanceLabel}
            </span>
          </div>
        </div>

        <div className="sobre-input-group">
          <div className="flex items-end justify-between mb-2">
            <label htmlFor="deposit-amount">Amount</label>
            <UnitToggle unit={unit} onChange={switchUnit} disabled={pending} />
          </div>
          <div className="sobre-input-wrap">
            {unit === "PHP" ? (
              <span className="prefix">₱</span>
            ) : null}
            <input
              id="deposit-amount"
              ref={inputRef}
              className={`sobre-input tabular ${unit === "PHP" ? "has-prefix" : ""}`}
              type="number"
              inputMode="decimal"
              min="0"
              step={unit === "PHP" ? "1" : "0.0001"}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              disabled={pending}
            />
          </div>
          <div
            className="mt-2 text-[12px] tabular"
            style={{ color: "var(--text-3)" }}
          >
            {unit === "PHP"
              ? `≈ ${usdc.toFixed(4)} ${PAYMENT_TOKEN_LABEL} at ₱${rateLabel}/${PAYMENT_TOKEN_LABEL}`
              : `≈ ₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at ₱${rateLabel}/${PAYMENT_TOKEN_LABEL}`}
          </div>
          <div className="sobre-quick-amts">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                className={amountStr === String(q) ? "active" : ""}
                onClick={() => setAmountStr(String(q))}
                disabled={pending}
              >
                {fmtQuick(q)}
              </button>
            ))}
          </div>
        </div>

        {valid && state.percents.length === ENVELOPE_LABELS.length ? (
          <div
            className="rounded-[10px] p-[14px_16px] mb-[18px]"
            style={{ background: "var(--surface-alt)" }}
          >
            <div className="sobre-label mb-2.5">Auto-split preview</div>
            {ENVELOPE_LABELS.map((env, i) => {
              const portion = (usdc * state.percents[i]) / 100;
              const portionPhp = portion * phpPerToken;
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
                    +{" "}
                    {unit === "PHP"
                      ? `₱${portionPhp.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : `${portion.toFixed(4)} ${PAYMENT_TOKEN_LABEL}`}
                  </span>
                </div>
              );
            })}
          </div>
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
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="sobre-btn sobre-btn-primary"
            onClick={() => void handleSubmit()}
            disabled={!valid || pending}
            style={
              !valid || pending ? { opacity: 0.5, cursor: "not-allowed" } : {}
            }
          >
            {pending ? "Submitting…" : "Send remittance"}
          </button>
        </div>
    </Sheet>
  );
}

/** Small two-segment toggle for switching the amount input between PHP and USDC. */
function UnitToggle({
  unit,
  onChange,
  disabled,
}: {
  unit: Unit;
  onChange: (next: Unit) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sobre-unit-toggle" aria-label="Amount unit">
      {(["PHP", "USDC"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          disabled={disabled}
          data-active={u === unit ? "true" : "false"}
        >
          {u === "PHP" ? "₱ PHP" : PAYMENT_TOKEN_LABEL}
        </button>
      ))}
    </div>
  );
}
