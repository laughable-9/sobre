"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { useCloseWallet } from "@/hooks/useCloseWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { PHP_PER_XLM, STROOPS_PER_XLM } from "@/lib/config";

export function CloseWalletModal({
  adminAddress,
  state,
  onClose,
  onSuccess,
}: {
  adminAddress: string;
  state: WalletState;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const { closeWallet, pending, error } = useCloseWallet(adminAddress);
  const total = state.balances.reduce((a, b) => a + b, 0n);
  const totalXlm = Number(total) / STROOPS_PER_XLM;
  const totalPhp = totalXlm * PHP_PER_XLM;

  const confirmed = confirmText.trim().toUpperCase() === "CLOSE";

  const handleSubmit = async () => {
    if (!confirmed) return;
    try {
      await closeWallet();
      onSuccess();
    } catch {
      // error on hook
    }
  };

  return (
    <div className="sobre-modal-bg" onClick={onClose}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-1.5">
          <div
            className="grid place-items-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#fbe4e0",
              color: "var(--sobre-danger)",
            }}
          >
            <AlertTriangle size={20} strokeWidth={2} />
          </div>
          <h2 style={{ margin: 0 }}>Close wallet?</h2>
        </div>
        <p className="sub">
          This sweeps every envelope back to your address and empties the
          wallet. The wallet stays callable — re-depositing would re-split per
          the percentages — but for the demo this is the &quot;close out&quot;
          action.
        </p>

        <div
          className="rounded-[10px] p-3 mb-4"
          style={{ background: "var(--surface-alt)" }}
        >
          <div
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-3)", fontWeight: 600 }}
          >
            Sweeping back to you
          </div>
          <div
            className="tabular mt-1"
            style={{
              fontFamily: "var(--serif)",
              fontSize: 26,
              fontWeight: 600,
              color: "var(--text-1)",
            }}
          >
            ₱{" "}
            {totalPhp.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div
            className="text-[12px] tabular mt-0.5"
            style={{ color: "var(--text-2)" }}
          >
            {totalXlm.toFixed(4)} XLM across all 3 envelopes
          </div>
        </div>

        <div className="sobre-input-group">
          <label htmlFor="close-confirm">
            Type <b>CLOSE</b> to confirm
          </label>
          <input
            id="close-confirm"
            className="sobre-input"
            type="text"
            placeholder="CLOSE"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={pending}
            autoFocus
          />
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
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="sobre-btn sobre-btn-danger"
            onClick={() => void handleSubmit()}
            disabled={!confirmed || pending}
            style={
              !confirmed || pending
                ? { opacity: 0.5, cursor: "not-allowed" }
                : {}
            }
          >
            {pending ? "Closing…" : "Close wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
