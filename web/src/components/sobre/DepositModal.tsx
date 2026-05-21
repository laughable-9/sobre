"use client";

import { useEffect, useRef, useState } from "react";

import { useDeposit } from "@/hooks/useDeposit";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_XLM,
  STROOPS_PER_XLM,
} from "@/lib/config";

const QUICK = [1, 5, 10, 50];

export function DepositModal({
  userAddress,
  state,
  onClose,
  onSuccess,
}: {
  userAddress: string;
  state: WalletState;
  onClose: () => void;
  /** Called after the tx lands on chain with the actual XLM amount sent. */
  onSuccess: (info: { xlm: number; stroops: bigint }) => void;
}) {
  const [xlmStr, setXlmStr] = useState("10");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { deposit, pending, error } = useDeposit(userAddress);
  const xlm = Number(xlmStr);
  const valid = isFinite(xlm) && xlm > 0;
  const php = (valid ? xlm : 0) * PHP_PER_XLM;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async () => {
    if (!valid) return;
    const stroops = BigInt(Math.round(xlm * STROOPS_PER_XLM));
    try {
      await deposit(stroops);
      onSuccess({ xlm, stroops });
    } catch {
      // error already on hook
    }
  };

  return (
    <div className="sobre-modal-bg" onClick={onClose}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add a remittance</h2>
        <p className="sub">
          Sobre auto-splits your XLM across the envelopes per the configured
          percentages.
        </p>

        <div className="sobre-input-group">
          <label htmlFor="deposit-amount">XLM amount</label>
          <input
            id="deposit-amount"
            ref={inputRef}
            className="sobre-input tabular"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.0001"
            value={xlmStr}
            onChange={(e) => setXlmStr(e.target.value)}
            disabled={pending}
          />
          <div
            className="mt-2.5 text-[13px]"
            style={{ color: "var(--text-2)" }}
          >
            ≈{" "}
            <b className="tabular" style={{ color: "var(--text-1)" }}>
              ₱{" "}
              {php.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </b>{" "}
            at ₱{PHP_PER_XLM}/XLM
          </div>
          <div className="sobre-quick-amts">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                className={xlmStr === String(q) ? "active" : ""}
                onClick={() => setXlmStr(String(q))}
                disabled={pending}
              >
                {q} XLM
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
              const portion = (xlm * state.percents[i]) / 100;
              return (
                <div
                  key={env}
                  className="flex justify-between items-center py-1.5 text-[14px]"
                >
                  <span style={{ color: "var(--text-1)" }}>
                    {env}{" "}
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
                    + {portion.toFixed(4)} XLM
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
