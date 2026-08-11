"use client";

import { useCallback, useRef, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { PAYMENT_TOKEN_SAC_ID, type EnvelopeName } from "@/lib/config";
import { envelopeScVal, invokeWrite } from "@/lib/contract";

/**
 * Withdraw from a Sobre straight to any Stellar address, in the two
 * signed legs the contract forces on us:
 *
 *   1. `withdraw(caller, envelope, amount, memo)` — or
 *      `withdraw_subaccount(caller, amount, memo)` for a supplementary
 *      holder. Both always pay out to `caller`, so the money lands in the
 *      user's own smart wallet first. Passkey prompt 1 of 2.
 *   2. SAC `transfer(caller, destination, amount)` — smart wallet to the
 *      address the user typed. Passkey prompt 2 of 2.
 *
 * Soroban permits one InvokeHostFunctionOp per transaction, so there is
 * no way to fold these into one signature without a wrapper contract.
 *
 * The case that matters is leg 1 landing while leg 2 fails: the money is
 * in the user's smart wallet, not lost. That outcome carries
 * `stage: "transfer"` plus the leg-1 hash so the caller can offer a retry
 * that fires ONLY leg 2 via `sendOnly` — re-running both would debit the
 * envelope a second time.
 */

export type CryptoWithdrawStep = "idle" | "withdrawing" | "sending";

export type CryptoWithdrawOutcome =
  | { ok: true; withdrawTxHash: string | null; transferTxHash: string }
  | {
      ok: false;
      /** Which leg failed. "transfer" means leg 1 already moved the money
       *  into the user's smart wallet. */
      stage: "withdraw" | "transfer";
      error: string;
      withdrawTxHash: string | null;
    };

export interface CryptoWithdrawArgs {
  /** Envelope to debit. Null draws from the caller's own supplementary
   *  balance instead (`withdraw_subaccount`). */
  envelope: EnvelopeName | null;
  amountStroops: bigint;
  destination: string;
  memo: string;
}

export interface UseCryptoWithdrawResult {
  withdrawAndSend: (args: CryptoWithdrawArgs) => Promise<CryptoWithdrawOutcome>;
  /** Leg 2 on its own, for retrying after leg 1 already landed. */
  sendOnly: (args: {
    amountStroops: bigint;
    destination: string;
  }) => Promise<CryptoWithdrawOutcome>;
  pending: boolean;
  step: CryptoWithdrawStep;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useCryptoWithdraw(
  userAddress: string | null,
  contractId: string | null,
): UseCryptoWithdrawResult {
  const [step, setStep] = useState<CryptoWithdrawStep>("idle");
  const pending = step !== "idle";
  // Synchronous re-entrancy guard: a rapid double-tap arrives before
  // React has re-rendered the disabled button.
  const inFlightRef = useRef(false);

  const withdrawAndSend = useCallback(
    async (args: CryptoWithdrawArgs): Promise<CryptoWithdrawOutcome> => {
      if (!userAddress || !contractId) {
        return {
          ok: false,
          stage: "withdraw",
          error: "Wallet not connected.",
          withdrawTxHash: null,
        };
      }
      if (inFlightRef.current) {
        return {
          ok: false,
          stage: "withdraw",
          error: "A withdrawal is already in progress.",
          withdrawTxHash: null,
        };
      }
      inFlightRef.current = true;
      try {
        const caller = Address.fromString(userAddress).toScVal();
        const amount = nativeToScVal(args.amountStroops, { type: "i128" });
        const memo = nativeToScVal(args.memo, { type: "string" });

        setStep("withdrawing");
        let withdrawTxHash: string;
        try {
          const result = args.envelope
            ? await invokeWrite(contractId, "withdraw", [
                caller,
                envelopeScVal(args.envelope),
                amount,
                memo,
              ])
            : await invokeWrite(contractId, "withdraw_subaccount", [
                caller,
                amount,
                memo,
              ]);
          withdrawTxHash = result.hash;
        } catch (e) {
          return {
            ok: false,
            stage: "withdraw",
            error: messageOf(e),
            withdrawTxHash: null,
          };
        }

        setStep("sending");
        try {
          const forward = await invokeWrite(PAYMENT_TOKEN_SAC_ID, "transfer", [
            caller,
            Address.fromString(args.destination).toScVal(),
            amount,
          ]);
          return { ok: true, withdrawTxHash, transferTxHash: forward.hash };
        } catch (e) {
          return {
            ok: false,
            stage: "transfer",
            error: messageOf(e),
            withdrawTxHash,
          };
        }
      } finally {
        setStep("idle");
        inFlightRef.current = false;
      }
    },
    [userAddress, contractId],
  );

  const sendOnly = useCallback(
    async (args: {
      amountStroops: bigint;
      destination: string;
    }): Promise<CryptoWithdrawOutcome> => {
      if (!userAddress) {
        return {
          ok: false,
          stage: "transfer",
          error: "Wallet not connected.",
          withdrawTxHash: null,
        };
      }
      if (inFlightRef.current) {
        return {
          ok: false,
          stage: "transfer",
          error: "A withdrawal is already in progress.",
          withdrawTxHash: null,
        };
      }
      inFlightRef.current = true;
      setStep("sending");
      try {
        const forward = await invokeWrite(PAYMENT_TOKEN_SAC_ID, "transfer", [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(args.destination).toScVal(),
          nativeToScVal(args.amountStroops, { type: "i128" }),
        ]);
        return {
          ok: true,
          withdrawTxHash: null,
          transferTxHash: forward.hash,
        };
      } catch (e) {
        return {
          ok: false,
          stage: "transfer",
          error: messageOf(e),
          withdrawTxHash: null,
        };
      } finally {
        setStep("idle");
        inFlightRef.current = false;
      }
    },
    [userAddress],
  );

  return { withdrawAndSend, sendOnly, pending, step };
}
