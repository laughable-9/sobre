"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { PAYMENT_TOKEN_SAC_ID } from "@/lib/config";
import { invokeWrite, simulateRead } from "@/lib/contract";

export interface UseDepositResult {
  /** `percents` is admin's latest split (Supabase-resident); the caller
   *  passes it explicitly so we don't re-fetch from inside the hook. */
  deposit: (
    amountStroops: bigint,
    percents: [number, number, number],
  ) => Promise<string>;
  pending: boolean;
  step: "idle" | "checking_balance" | "depositing";
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps `deposit_with_split(from, groceries, tuition, savings)`. The amounts
 * are computed off-chain from the family's Supabase-stored split percentages
 * so admin can change the split freely with zero chain fees — the next
 * deposit just uses the latest percents passed in.
 *
 * Includes a balance pre-check loop because Soroban RPC sometimes serves a
 * slightly stale snapshot of the SAC balance entry for a few seconds after
 * the relay's SAC transfer lands.
 */
export function useDeposit(
  userAddress: string | null,
  contractId: string | null,
): UseDepositResult {
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<
    "idle" | "checking_balance" | "depositing"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const deposit = useCallback(
    async (
      amountStroops: bigint,
      percents: [number, number, number],
    ): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      if (amountStroops <= 0n) throw new Error("Deposit amount must be positive.");
      setPending(true);
      setError(null);
      try {
        setStep("checking_balance");
        await waitForSacBalance(userAddress, amountStroops);

        setStep("depositing");
        const { groceries, tuition, savings } = splitAmount(
          amountStroops,
          percents,
        );
        const args = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(groceries, { type: "i128" }),
          nativeToScVal(tuition, { type: "i128" }),
          nativeToScVal(savings, { type: "i128" }),
        ];
        const { hash } = await invokeWrite(
          contractId,
          "deposit_with_split",
          args,
        );
        setLastHash(hash);
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setStep("idle");
        setPending(false);
      }
    },
    [userAddress, contractId],
  );

  return { deposit, pending, step, error, lastHash };
}

/** Total = groceries + tuition + savings. Rounding remainder lands in
 *  savings so the integer sum exactly matches `amountStroops`. */
export function splitAmount(
  amountStroops: bigint,
  percents: [number, number, number],
): { groceries: bigint; tuition: bigint; savings: bigint } {
  if (percents[0] + percents[1] + percents[2] !== 100) {
    throw new Error("Split percentages must sum to 100.");
  }
  const groceries = (amountStroops * BigInt(percents[0])) / 100n;
  const tuition = (amountStroops * BigInt(percents[1])) / 100n;
  const savings = amountStroops - groceries - tuition;
  return { groceries, tuition, savings };
}

async function waitForSacBalance(
  userAddress: string,
  neededStroops: bigint,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const balance = await simulateRead<bigint>(
        PAYMENT_TOKEN_SAC_ID,
        "balance",
        [Address.fromString(userAddress).toScVal()],
      );
      if (balance >= neededStroops) return;
    } catch {
      // RPC blip — next tick retries
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    "Funds haven't fully landed in your wallet yet. Try again in a few seconds.",
  );
}
