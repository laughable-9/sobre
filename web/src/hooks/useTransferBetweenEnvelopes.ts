"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

export interface UseTransferBetweenEnvelopesResult {
  transfer: (args: {
    contractId: string;
    sourceEnvelope: EnvelopeName;
    destinationEnvelope: EnvelopeName;
    amountStroops: bigint;
  }) => Promise<{ withdrawTxHash: string; depositTxHash: string }>;
  pending: boolean;
  error: string | null;
  step: "idle" | "withdrawing" | "depositing";
}

/**
 * Two-passkey envelope-to-envelope move inside the same Sobre.
 *
 *   1. `withdraw(caller, source, amount, memo)` — source envelope
 *      debits, tokens land in the user's smart wallet.
 *   2. `deposit_with_split(from=caller, g, t, s)` on the SAME
 *      contract, with only the destination envelope's slot set to
 *      `amount` and the other two at 0 — user smart wallet debits,
 *      the destination envelope credits. Net movement is a pure
 *      envelope reallocation; total wallet balance is unchanged.
 *
 *  Two passkey prompts because Soroban won't let one tx envelope
 *  carry a Withdraw and a Deposit auth entry for the same caller
 *  against the same contract without a batching wrapper. Every
 *  other cashout in the app already sits in this same shape
 *  (spend + SAC transfer), so users are used to it.
 */
export function useTransferBetweenEnvelopes(
  userAddress: string | null,
): UseTransferBetweenEnvelopesResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "withdrawing" | "depositing">(
    "idle",
  );

  const transfer = useCallback(
    async (args: {
      contractId: string;
      sourceEnvelope: EnvelopeName;
      destinationEnvelope: EnvelopeName;
      amountStroops: bigint;
    }): Promise<{ withdrawTxHash: string; depositTxHash: string }> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (args.sourceEnvelope === args.destinationEnvelope) {
        throw new Error("Source and destination envelopes are the same.");
      }
      setPending(true);
      setError(null);
      try {
        setStep("withdrawing");
        const memo = `Move to ${args.destinationEnvelope}`;
        const withdrawArgs = [
          Address.fromString(userAddress).toScVal(),
          envelopeScVal(args.sourceEnvelope),
          nativeToScVal(args.amountStroops, { type: "i128" }),
          nativeToScVal(memo, { type: "string" }),
        ];
        const withdrawResult = await invokeWrite(
          args.contractId,
          "withdraw",
          withdrawArgs,
        );

        setStep("depositing");
        // Zero for every slot except the destination — deposit_with_split
        // credits each envelope by its slot amount. Total = amount, so
        // only the chosen envelope gains.
        const g =
          args.destinationEnvelope === "Groceries" ? args.amountStroops : 0n;
        const t =
          args.destinationEnvelope === "Tuition" ? args.amountStroops : 0n;
        const s =
          args.destinationEnvelope === "Savings" ? args.amountStroops : 0n;
        const depositArgs = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(g, { type: "i128" }),
          nativeToScVal(t, { type: "i128" }),
          nativeToScVal(s, { type: "i128" }),
        ];
        const depositResult = await invokeWrite(
          args.contractId,
          "deposit_with_split",
          depositArgs,
        );

        return {
          withdrawTxHash: withdrawResult.hash,
          depositTxHash: depositResult.hash,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setStep("idle");
        setPending(false);
      }
    },
    [userAddress],
  );

  return { transfer, pending, error, step };
}
