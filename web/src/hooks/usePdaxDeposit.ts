"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Drives the "Add money via PDAX" flow:
 *
 *   1. `initiate(amountPhp)` → POST /api/pdax/fiat/deposit. Returns the
 *      `identifier` + the InstaPay `paymentCheckoutUrl` the user opens to
 *      complete payment.
 *   2. The hook subscribes to the matching `pdax_deposits` row via Supabase
 *      Realtime. As PDAX walks the state machine (pending → funded →
 *      credited) the webhook handler updates the row and the subscription
 *      surfaces each transition.
 *   3. When the row reaches `credited`, the smart wallet has the USDC and
 *      the UI prompts the user to confirm the on-chain split. That call
 *      goes through the existing `useDeposit` hook; on success the caller
 *      marks the row `split` via `markSplit()`.
 */

export type DepositStatus =
  | "pending"
  | "funded"
  | "credited"
  | "split"
  | "failed";

export interface PdaxDepositRow {
  identifier: string;
  amount_php: number;
  amount_usdc: number | null;
  payment_checkout_url: string | null;
  status: DepositStatus;
  failure_reason: string | null;
}

export interface UsePdaxDepositResult {
  /** Kick off a new deposit. Returns the identifier + the checkout URL the
   *  user opens to pay via InstaPay. The hook auto-subscribes to row
   *  updates after this call. */
  initiate: (amountPhp: number) => Promise<{
    identifier: string;
    paymentCheckoutUrl: string;
  }>;
  /** Latest row snapshot from Realtime. null until `initiate()` succeeds. */
  row: PdaxDepositRow | null;
  /** Mark the deposit as fully split on-chain. Called after the
   *  user-confirmed `deposit()` tx settles. */
  markSplit: (txHash: string) => Promise<void>;
  /** True while an API call (initiate or markSplit) is in flight. */
  pending: boolean;
  error: string | null;
}

export function usePdaxDeposit(contractId: string | null): UsePdaxDepositResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<PdaxDepositRow | null>(null);
  const identifierRef = useRef<string | null>(null);

  // Subscribe to the matching row's updates whenever `identifier` is set.
  useEffect(() => {
    const identifier = row?.identifier ?? identifierRef.current;
    if (!identifier) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`pdax_deposit:${identifier}`)
      .on(
        "postgres_changes" as never,
        {
          event: "UPDATE",
          schema: "public",
          table: "pdax_deposits",
          filter: `identifier=eq.${identifier}`,
        },
        (payload: { new: PdaxDepositRow }) => {
          setRow(payload.new);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [row?.identifier]);

  const initiate = useCallback(
    async (amountPhp: number) => {
      if (!contractId) throw new Error("No wallet selected.");
      if (!Number.isFinite(amountPhp) || amountPhp <= 0) {
        throw new Error("Amount must be > 0.");
      }
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/pdax/fiat/deposit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amount_php: amountPhp,
            contract_id: contractId,
          }),
        });
        const json = (await res.json()) as
          | { identifier: string; paymentCheckoutUrl: string }
          | { error: string; pdax?: unknown };
        if (!res.ok || !("identifier" in json)) {
          const msg = "error" in json ? json.error : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        identifierRef.current = json.identifier;
        setRow({
          identifier: json.identifier,
          amount_php: amountPhp,
          amount_usdc: null,
          payment_checkout_url: json.paymentCheckoutUrl,
          status: "pending",
          failure_reason: null,
        });
        return {
          identifier: json.identifier,
          paymentCheckoutUrl: json.paymentCheckoutUrl,
        };
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

  const markSplit = useCallback(async (txHash: string) => {
    const identifier = identifierRef.current;
    if (!identifier) throw new Error("No deposit in flight.");
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/pdax/deposits/${identifier}/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ split_tx_hash: txHash }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRow((prev) =>
        prev ? { ...prev, status: "split" } : prev,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setPending(false);
    }
  }, []);

  return { initiate, row, markSplit, pending, error };
}
