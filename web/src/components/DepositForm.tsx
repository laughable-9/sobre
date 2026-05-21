"use client";

import { useState } from "react";

import { useDeposit } from "@/hooks/useDeposit";
import { STROOPS_PER_XLM } from "@/lib/config";

export function DepositForm({
  userAddress,
  onSuccess,
}: {
  userAddress: string | null;
  onSuccess: () => void;
}) {
  const [amountXlm, setAmountXlm] = useState("10");
  const { deposit, pending, error, lastHash } = useDeposit(userAddress);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const xlm = Number(amountXlm);
    if (!isFinite(xlm) || xlm <= 0) return;
    const stroops = BigInt(Math.round(xlm * STROOPS_PER_XLM));
    try {
      await deposit(stroops);
      onSuccess();
    } catch {
      // error already set in hook
    }
  };

  if (!userAddress) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.0000001"
          min="0"
          value={amountXlm}
          onChange={(e) => setAmountXlm(e.target.value)}
          className="w-32 rounded border px-2 py-1 text-sm"
          placeholder="XLM"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Depositing…" : "Deposit"}
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
