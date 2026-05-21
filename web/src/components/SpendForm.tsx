"use client";

import { useState } from "react";

import { useSpend } from "@/hooks/useSpend";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_XLM,
  type EnvelopeName,
} from "@/lib/config";

export function SpendForm({
  userAddress,
  onSuccess,
}: {
  userAddress: string | null;
  onSuccess: () => void;
}) {
  const [envelope, setEnvelope] = useState<EnvelopeName>("Groceries");
  const [amountXlm, setAmountXlm] = useState("1");
  const [memo, setMemo] = useState("");
  const { spend, pending, error, lastHash } = useSpend(userAddress);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const xlm = Number(amountXlm);
    if (!isFinite(xlm) || xlm <= 0) return;
    const stroops = BigInt(Math.round(xlm * STROOPS_PER_XLM));
    try {
      await spend(envelope, stroops, memo);
      onSuccess();
      setMemo("");
    } catch {
      // error already set in hook
    }
  };

  if (!userAddress) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={envelope}
          onChange={(e) => setEnvelope(e.target.value as EnvelopeName)}
          disabled={pending}
          className="rounded border px-2 py-1 text-sm"
        >
          {ENVELOPE_LABELS.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.0000001"
          min="0"
          value={amountXlm}
          onChange={(e) => setAmountXlm(e.target.value)}
          className="w-28 rounded border px-2 py-1 text-sm"
          placeholder="XLM"
          disabled={pending}
        />
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          className="flex-1 min-w-[12rem] rounded border px-2 py-1 text-sm"
          placeholder="memo (what was this for?)"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Spending…" : "Spend"}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-destructive break-all">{error}</p>
      ) : null}
      {lastHash ? (
        <p className="text-xs text-emerald-600">tx: {lastHash.slice(0, 16)}…</p>
      ) : null}
    </form>
  );
}
