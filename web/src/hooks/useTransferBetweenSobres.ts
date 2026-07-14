"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";

/** Split an integer stroop amount by three percentages (summing to
 *  100). Any rounding remainder lands in the first envelope so the
 *  destination Sobre's balance grows by exactly the amount the user
 *  authorised.
 */
function splitByPercents(
  amountStroops: bigint,
  percents: readonly [number, number, number],
): [bigint, bigint, bigint] {
  const [gPct, tPct, sPct] = percents;
  const g = (amountStroops * BigInt(gPct)) / 100n;
  const t = (amountStroops * BigInt(tPct)) / 100n;
  const s = amountStroops - g - t;
  void sPct;
  return [g, t, s];
}

export interface UseTransferBetweenSobresResult {
  transfer: (args: {
    sourceContractId: string;
    sourceEnvelope: EnvelopeName;
    destinationContractId: string;
    destinationPercents: readonly [number, number, number];
    amountStroops: bigint;
    destinationDisplayName: string;
  }) => Promise<{ withdrawTxHash: string; depositTxHash: string }>;
  pending: boolean;
  error: string | null;
  step: "idle" | "withdrawing" | "depositing";
}

/**
 * Two-passkey inter-Sobre transfer:
 *
 *   1. `withdraw(caller, envelope, amount, memo)` on the SOURCE Sobre
 *      — pulls from the envelope into the user's smart wallet.
 *   2. `deposit_with_split(from=caller, g, t, s)` on the DESTINATION
 *      Sobre — credits the destination's envelopes, split by its
 *      configured percents.
 *
 *  Neither step needs a relay — the tokens move user→user via SAC
 *  transfers implicit in each contract call. Both prompts are the
 *  caller's passkey.
 */
export function useTransferBetweenSobres(
  userAddress: string | null,
): UseTransferBetweenSobresResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "withdrawing" | "depositing">(
    "idle",
  );

  const transfer = useCallback(
    async (args: {
      sourceContractId: string;
      sourceEnvelope: EnvelopeName;
      destinationContractId: string;
      destinationPercents: readonly [number, number, number];
      amountStroops: bigint;
      destinationDisplayName: string;
    }): Promise<{ withdrawTxHash: string; depositTxHash: string }> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        setStep("withdrawing");
        const memo = `Transfer to ${args.destinationDisplayName}`;
        const withdrawArgs = [
          Address.fromString(userAddress).toScVal(),
          envelopeScVal(args.sourceEnvelope),
          nativeToScVal(args.amountStroops, { type: "i128" }),
          nativeToScVal(memo, { type: "string" }),
        ];
        const withdrawResult = await invokeWrite(
          args.sourceContractId,
          "withdraw",
          withdrawArgs,
        );

        setStep("depositing");
        const [g, t, s] = splitByPercents(
          args.amountStroops,
          args.destinationPercents,
        );
        const depositArgs = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(g, { type: "i128" }),
          nativeToScVal(t, { type: "i128" }),
          nativeToScVal(s, { type: "i128" }),
        ];
        const depositResult = await invokeWrite(
          args.destinationContractId,
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
