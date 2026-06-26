"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { PAYMENT_TOKEN_SAC_ID } from "@/lib/config";
import { invokeWrite, simulateRead } from "@/lib/contract";

export interface UseDepositResult {
  deposit: (amountStroops: bigint) => Promise<string>;
  pending: boolean;
  /** Tracks which sub-step is running so the modal can render specific
   *  spinner copy ("Waiting for funds…" while the SAC balance catches up
   *  vs. "Splitting across envelopes…" once we've actually fired the call). */
  step: "idle" | "checking_balance" | "depositing";
  error: string | null;
  lastHash: string | null;
}

/**
 * Wraps the deposit(from, amount) contract call. Uses the connected user's
 * address as the `from` argument; their passkey signature authorizes both
 * the outer Sobre call and the inner SAC `transfer` sub-call.
 *
 * Includes a balance pre-check loop because Soroban RPC sometimes serves a
 * slightly stale snapshot of the SAC balance entry for a few seconds after
 * the relay's SAC transfer lands. Without the pre-check, the deposit()
 * call lands on a node that still sees the pre-transfer balance and
 * traps with "balance is not sufficient to spend". Polling balance()
 * until it catches up costs little and removes the race entirely.
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
    async (amountStroops: bigint): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        setStep("checking_balance");
        await waitForSacBalance(userAddress, amountStroops);

        setStep("depositing");
        const args = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(amountStroops, { type: "i128" }),
        ];
        const { hash } = await invokeWrite(contractId, "deposit", args);
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

/** Poll the payment-token SAC's `balance(addr)` until it covers the amount
 *  we're about to deposit, or 30s pass. Each call is a cheap read-only
 *  simulation; we sleep 500ms between attempts. */
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
