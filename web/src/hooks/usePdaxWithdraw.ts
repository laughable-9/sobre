"use client";

import { useCallback, useRef, useState } from "react";

import { useRowRealtime } from "@/hooks/useRowRealtime";

/**
 * Drives the "Cash out via PDAX" flow. Mirror of usePdaxDeposit:
 *
 *   1. `initiate(args)` → POST /api/pdax/fiat/withdraw. Returns the
 *      `identifier` + the `relayG` address the user needs to SAC-transfer
 *      to from their smart wallet.
 *   2. The hook subscribes to the matching `pdax_withdrawals` row via
 *      Supabase Realtime. As the server-side pipeline marches
 *      (pending → spent → transferred → converted → paid) the
 *      subscription surfaces each transition for the modal to render.
 *   3. After the user signs the two on-chain ops (spend + SAC transfer),
 *      the modal calls `confirmSigned(spendHash, forwardHash)` which flips
 *      the row to 'spent' and lets the poll-status loop take over.
 */

export type WithdrawStatus =
  | "pending"
  | "spent"
  | "transferred"
  | "converted"
  | "paid"
  | "failed";

export interface PdaxWithdrawRow {
  identifier: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  amount_usdc: number;
  amount_php: number | null;
  status: WithdrawStatus;
  failure_reason: string | null;
  beneficiary_bank_code: string;
  beneficiary_account_name: string;
  beneficiary_account_number: string;
}

export interface InitiateArgs {
  envelope: "Groceries" | "Tuition" | "Savings";
  amountToken: number;
  amountPhp: number;
  /** Optional explicit bank override. When omitted, the server falls back to
   *  the member's `member_bank_details` row. */
  bankCode?: string;
  accountName?: string;
  accountNumber?: string;
}

export interface InitiateResult {
  identifier: string;
  relayG: string;
}

export interface UsePdaxWithdrawResult {
  initiate: (args: InitiateArgs) => Promise<InitiateResult>;
  confirmSigned: (args: {
    spendTxHash: string;
    forwardTxHash: string;
  }) => Promise<void>;
  /** Latest row snapshot from Realtime. null until `initiate()` succeeds. */
  row: PdaxWithdrawRow | null;
  pending: boolean;
  error: string | null;
}

export function usePdaxWithdraw(
  contractId: string | null,
): UsePdaxWithdrawResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<PdaxWithdrawRow | null>(null);
  const identifierRef = useRef<string | null>(null);

  useRowRealtime<PdaxWithdrawRow>(
    "pdax_withdrawals",
    row?.identifier ?? null,
    setRow,
  );

  const initiate = useCallback(
    async (args: InitiateArgs): Promise<InitiateResult> => {
      if (!contractId) throw new Error("No wallet selected.");
      if (!Number.isFinite(args.amountToken) || args.amountToken <= 0) {
        throw new Error("Amount must be > 0.");
      }
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/pdax/fiat/withdraw", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contract_id: contractId,
            envelope: args.envelope,
            amount_token: args.amountToken,
            amount_php: args.amountPhp,
            bank_code: args.bankCode,
            account_name: args.accountName,
            account_number: args.accountNumber,
          }),
        });
        const json = (await res.json()) as
          | { identifier: string; relayG: string }
          | { error: string; pdax?: unknown };
        if (!res.ok || !("identifier" in json)) {
          const msg = "error" in json ? json.error : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        identifierRef.current = json.identifier;
        setRow({
          identifier: json.identifier,
          envelope: args.envelope,
          amount_usdc: args.amountToken,
          amount_php: args.amountPhp,
          status: "pending",
          failure_reason: null,
          beneficiary_bank_code: args.bankCode ?? "",
          beneficiary_account_name: args.accountName ?? "",
          beneficiary_account_number: args.accountNumber ?? "",
        });
        return { identifier: json.identifier, relayG: json.relayG };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [contractId],
  );

  const confirmSigned = useCallback(
    async (args: { spendTxHash: string; forwardTxHash: string }) => {
      const identifier = identifierRef.current;
      if (!identifier) throw new Error("No withdrawal in flight.");
      setPending(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/pdax/withdrawals/${identifier}/confirmed`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spend_tx_hash: args.spendTxHash,
              forward_tx_hash: args.forwardTxHash,
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setRow((prev) => (prev ? { ...prev, status: "spent" } : prev));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { initiate, confirmSigned, row, pending, error };
}
