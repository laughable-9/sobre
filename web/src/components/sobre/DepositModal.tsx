"use client";

import { useEffect, useRef, useState } from "react";

import { useDeposit } from "@/hooks/useDeposit";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_USDC,
  displayEnvelopeName,
} from "@/lib/config";
import { backdropClose } from "@/lib/ui";
import { PHP_PER_USDC } from "@/lib/config";

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
  /** Called after the tx lands on chain with the actual USDC amount sent. */
  onSuccess: (info: { usdc: number; stroops: bigint }) => void;
}) {
  const [unit, setUnit] = useState<Unit>("PHP");
  const [amountStr, setAmountStr] = useState("500");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { deposit, pending, error } = useDeposit(userAddress, contractId);

  const amount = Number(amountStr);
  const valid = isFinite(amount) && amount > 0;
  const usdc = unit === "USDC" ? amount : amount / PHP_PER_USDC;
  const php = unit === "PHP" ? amount : amount * PHP_PER_USDC;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Convert the typed amount when toggling units so the underlying USDC
  // value stays the same; e.g. ₱500 toggled to USDC becomes 31.25. PHP keeps
  // 2 decimals so sub-peso USDC amounts survive a PHP → USDC → PHP round-trip
  // instead of getting quantised to whole pesos.
  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    const converted =
      next === "USDC"
        ? amount / PHP_PER_USDC
        : amount * PHP_PER_USDC;
    setAmountStr(
      Number.isFinite(converted) ? converted.toFixed(next === "USDC" ? 4 : 2) : "",
    );
    setUnit(next);
  };

  const handleSubmit = async () => {
    if (!valid) return;
    const stroops = BigInt(Math.round(usdc * STROOPS_PER_USDC));
    try {
      await deposit(stroops, state.percents);
      onSuccess({ usdc, stroops });
    } catch {
      // surfaces via the hook's error state
    }
  };

  const quick = unit === "PHP" ? QUICK_PHP : QUICK_USDC;
  const fmtQuick = (q: number) =>
    unit === "PHP" ? `₱${q.toLocaleString()}` : `${q} USDC`;

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add a remittance</h2>
        <p className="sub">
          Sobre auto-splits the deposit across the envelopes per the
          configured percentages.
        </p>

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
              ? `≈ ${usdc.toFixed(4)} USDC at ₱${PHP_PER_USDC}/USDC`
              : `≈ ₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at ₱${PHP_PER_USDC}/USDC`}
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
              const portionPhp = portion * PHP_PER_USDC;
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
                      : `${portion.toFixed(4)} USDC`}
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
      </div>
    </div>
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
          {u === "PHP" ? "₱ PHP" : "USDC"}
        </button>
      ))}
    </div>
  );
}
