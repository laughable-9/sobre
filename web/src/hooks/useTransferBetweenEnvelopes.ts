"use client";

import { useCallback, useRef, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";
import {
  clearTransferRecovery,
  readTransferRecovery,
  saveTransferRecovery,
  transferSnapshotMatches,
} from "@/lib/transferRecovery";

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
  // Re-entrancy guard against a rapid double-tap that fires two concurrent
  // transfers before React state disables the button. `pending` state alone
  // lags one render tick behind the click.
  const inFlightRef = useRef(false);

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
      if (inFlightRef.current) {
        throw new Error("A transfer is already in progress.");
      }
      inFlightRef.current = true;
      setPending(true);
      setError(null);
      try {
        // If a prior attempt's withdraw already succeeded (this args tuple
        // matches a snapshot), skip leg 1 — re-running withdraw would
        // double-debit the source envelope. Leg 2 is always safe to retry:
        // deposit_with_split debits the SIGNER's wallet, so if it failed
        // last time nothing moved.
        const priorSnapshot = readTransferRecovery();
        const skipWithdraw =
          priorSnapshot &&
          transferSnapshotMatches(priorSnapshot, {
            contractId: args.contractId,
            userAddress,
            sourceEnvelope: args.sourceEnvelope,
            destinationEnvelope: args.destinationEnvelope,
            amountStroops: args.amountStroops,
          });

        let withdrawTxHash: string;
        if (skipWithdraw) {
          withdrawTxHash = priorSnapshot.withdrawTxHash;
        } else {
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
          withdrawTxHash = withdrawResult.hash;
          // Snapshot BEFORE the deposit call — if leg 2 (or anything after)
          // fails, the next call will find this snapshot and skip leg 1.
          saveTransferRecovery({
            contractId: args.contractId,
            userAddress,
            sourceEnvelope: args.sourceEnvelope,
            destinationEnvelope: args.destinationEnvelope,
            amountStroops: args.amountStroops.toString(),
            withdrawTxHash,
          });
        }

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

        // Both legs landed — the snapshot has served its purpose.
        clearTransferRecovery();
        return {
          withdrawTxHash,
          depositTxHash: depositResult.hash,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setStep("idle");
        setPending(false);
        inFlightRef.current = false;
      }
    },
    [userAddress],
  );

  return { transfer, pending, error, step };
}
