"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import { PAYMENT_TOKEN_SAC_ID, type EnvelopeName } from "@/lib/config";
import {
  clearCashoutRecovery,
  saveCashoutRecovery,
} from "@/lib/cashoutRecovery";

/**
 * Cashout's two user-signed legs, packaged back-to-back:
 *   1. spend(envelope, amount, memo) on the family Sobre — XLM moves from
 *      the envelope to the user's smart wallet. Passkey prompt 1 of 2.
 *   2. SAC `transfer(user_smart_wallet, relayG, amount)` on the payment-token
 *      SAC — XLM moves from the smart wallet to the server relay. Passkey
 *      prompt 2 of 2.
 *
 * Both ops happen sequentially in one user-facing "confirm" action. We
 * intentionally do NOT short-circuit on the second leg's failure: if step 1
 * lands but step 2 doesn't, the XLM is in the user's smart wallet and they
 * can retry. The state is recoverable, just inconvenient.
 *
 * Soroban only permits one `InvokeHostFunctionOp` per transaction, so these
 * can't be batched into a single signature without a wrapper contract.
 */

/** Memo recorded on the on-chain `spend()` call. Appears in the activity feed
 *  alongside other envelope spends so the family can see this withdrawal
 *  was a PDAX cashout rather than a regular merchant spend. */
const SPEND_MEMO = "PDAX cashout";

/** Memo for sub-account cashouts. Same role as SPEND_MEMO but recorded by
 *  spend_from_subaccount; the SubAccountSpent event topic distinguishes it
 *  from a regular envelope cashout in the activity feed. */
const SUBACCOUNT_CASHOUT_MEMO = "Cash out";

/** Details a caller passes in alongside the on-chain args so a half-
 *  completed cashout (spend tx landed, SAC transfer didn't) can be fully
 *  re-attempted from cashoutRecovery state — including hitting /confirmed
 *  on the original row without losing the bank info. */
export interface CashoutLegArgs {
  identifier: string;
  envelope: EnvelopeName;
  amountStroops: bigint;
  amountPhp: number;
  amountToken: number;
  relayG: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}

export interface SubaccountCashoutLegArgs {
  identifier: string;
  subaccountId: string;
  amountStroops: bigint;
  amountPhp: number;
  amountToken: number;
  relayG: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}

export interface UseCashoutSignaturesResult {
  signAndForward: (
    args: CashoutLegArgs,
  ) => Promise<{ spendTxHash: string; forwardTxHash: string }>;
  /** Sub-account variant: replaces step 1's `spend(envelope, …)` with
   *  `withdraw_subaccount(caller, amount, memo)`. Same recovery snapshot
   *  pattern as the member path — the modal reads it on mount to resume
   *  a stranded row (leg-1 landed, leg-2 didn't). Step 2 (SAC transfer
   *  to the relay) is identical. */
  signSubaccountAndForward: (
    args: SubaccountCashoutLegArgs,
  ) => Promise<{ spendTxHash: string; forwardTxHash: string }>;
  /** Just the SAC transfer leg — for resuming a cashout whose spend
   *  already landed on chain. Recovers from a localStorage snapshot OR
   *  the server-side recoverable-rows endpoint. */
  retryForward: (args: {
    spendTxHash: string;
    amountStroops: bigint;
    relayG: string;
  }) => Promise<{ spendTxHash: string; forwardTxHash: string }>;
  pending: boolean;
  error: string | null;
  /** Tracks which sub-step is active so the modal can render
   *  "1 of 2 confirmed" between the two passkey prompts. */
  step: "idle" | "spending" | "forwarding";
}

export function useCashoutSignatures(
  userAddress: string | null,
  contractId: string | null,
): UseCashoutSignaturesResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "spending" | "forwarding">("idle");

  const signAndForward = useCallback(
    async (
      args: CashoutLegArgs,
    ): Promise<{ spendTxHash: string; forwardTxHash: string }> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        setStep("spending");
        const spendArgs = [
          Address.fromString(userAddress).toScVal(),
          envelopeScVal(args.envelope),
          nativeToScVal(args.amountStroops, { type: "i128" }),
          nativeToScVal(SPEND_MEMO, { type: "string" }),
        ];
        const spendResult = await invokeWrite(contractId, "withdraw", spendArgs);

        // Persist the moment we know the spend succeeded but BEFORE the
        // SAC transfer is even attempted. This is the partial-state
        // window where a failure used to strand XLM in the smart wallet
        // forever — now the modal can pick it up on the next mount.
        saveCashoutRecovery({
          kind: "member",
          identifier: args.identifier,
          contractId,
          spendTxHash: spendResult.hash,
          amountStroops: args.amountStroops.toString(),
          relayG: args.relayG,
          envelope: args.envelope,
          subaccountId: null,
          amountPhp: args.amountPhp,
          amountToken: args.amountToken,
          bankCode: args.bankCode,
          accountName: args.accountName,
          accountNumber: args.accountNumber,
        });

        setStep("forwarding");
        const transferArgs = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(args.relayG).toScVal(),
          nativeToScVal(args.amountStroops, { type: "i128" }),
        ];
        const forwardResult = await invokeWrite(
          PAYMENT_TOKEN_SAC_ID,
          "transfer",
          transferArgs,
        );

        // SAC transfer landed too — modal's /confirmed call will clear
        // the snapshot once it lands the row at status='spent'.
        return {
          spendTxHash: spendResult.hash,
          forwardTxHash: forwardResult.hash,
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
    [userAddress, contractId],
  );

  const retryForward = useCallback(
    async (args: {
      spendTxHash: string;
      amountStroops: bigint;
      relayG: string;
    }): Promise<{ spendTxHash: string; forwardTxHash: string }> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        setStep("forwarding");
        const transferArgs = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(args.relayG).toScVal(),
          nativeToScVal(args.amountStroops, { type: "i128" }),
        ];
        const forwardResult = await invokeWrite(
          PAYMENT_TOKEN_SAC_ID,
          "transfer",
          transferArgs,
        );
        return {
          spendTxHash: args.spendTxHash,
          forwardTxHash: forwardResult.hash,
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
    [userAddress, contractId],
  );

  const signSubaccountAndForward = useCallback(
    async (
      args: SubaccountCashoutLegArgs,
    ): Promise<{ spendTxHash: string; forwardTxHash: string }> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      if (!contractId) throw new Error("No wallet selected.");
      setPending(true);
      setError(null);
      try {
        setStep("spending");
        const spendArgs = [
          Address.fromString(userAddress).toScVal(),
          nativeToScVal(args.amountStroops, { type: "i128" }),
          nativeToScVal(SUBACCOUNT_CASHOUT_MEMO, { type: "string" }),
        ];
        const spendResult = await invokeWrite(
          contractId,
          "withdraw_subaccount",
          spendArgs,
        );

        // Snapshot after leg 1 lands. Same partial-state window as
        // member cashouts — a failure between here and leg 2 used to
        // strand USDC in the kid's smart wallet with no retry path.
        saveCashoutRecovery({
          kind: "subaccount",
          identifier: args.identifier,
          contractId,
          spendTxHash: spendResult.hash,
          amountStroops: args.amountStroops.toString(),
          relayG: args.relayG,
          envelope: null,
          subaccountId: args.subaccountId,
          amountPhp: args.amountPhp,
          amountToken: args.amountToken,
          bankCode: args.bankCode,
          accountName: args.accountName,
          accountNumber: args.accountNumber,
        });

        setStep("forwarding");
        const transferArgs = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(args.relayG).toScVal(),
          nativeToScVal(args.amountStroops, { type: "i128" }),
        ];
        const forwardResult = await invokeWrite(
          PAYMENT_TOKEN_SAC_ID,
          "transfer",
          transferArgs,
        );

        return {
          spendTxHash: spendResult.hash,
          forwardTxHash: forwardResult.hash,
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
    [userAddress, contractId],
  );

  return {
    signAndForward,
    signSubaccountAndForward,
    retryForward,
    pending,
    error,
    step,
  };
}

export { clearCashoutRecovery };
