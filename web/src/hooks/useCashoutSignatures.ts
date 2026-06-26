"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { envelopeScVal, invokeWrite } from "@/lib/contract";
import { PAYMENT_TOKEN_SAC_ID, type EnvelopeName } from "@/lib/config";

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

export interface UseCashoutSignaturesResult {
  signAndForward: (args: {
    envelope: EnvelopeName;
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
    async (args: {
      envelope: EnvelopeName;
      amountStroops: bigint;
      relayG: string;
    }): Promise<{ spendTxHash: string; forwardTxHash: string }> => {
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
        const spendResult = await invokeWrite(contractId, "spend", spendArgs);

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

  return { signAndForward, pending, error, step };
}
