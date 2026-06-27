"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";

import { NETWORK, type EnvelopeName } from "@/lib/config";
import { getServer, simulateSourceAccount } from "@/lib/contract";
import { envelopeNameFromScNative } from "@/lib/format";
import { useFamilyDisplay } from "@/hooks/useFamilyDisplay";

export interface SpendPolicy {
  require_all_sigs: boolean;
  daily_limit: bigint | null;
  /** Per-tx approval threshold in stroops, or null for no gate. */
  per_tx_threshold: bigint | null;
  protected_envelopes: EnvelopeName[];
}

export interface PendingRequest {
  id: bigint;
  caller: string;
  envelope: EnvelopeName;
  amount: bigint;
  memo: string;
  requested_at_ledger: number;
}

export interface Member {
  address: string;
  /** From Supabase. Empty string before Supabase resolves. */
  name: string;
  /** From Supabase. Empty string before Supabase resolves. */
  emoji: string;
}

export interface WalletState {
  admin: string;
  payment_token: string;
  /** From Supabase (family_wallets.display_name). Empty until resolved. */
  wallet_name: string;
  /** From Supabase (family_envelope_names). Falls back to canonical keys. */
  envelope_names: string[];
  percents: number[];
  members: Member[];
  balances: bigint[];
  policy: SpendPolicy;
  pending: PendingRequest[];
}

export interface UseWalletStateResult {
  state: WalletState | null;
  loading: boolean;
  error: string | null;
  /** family_wallets.id (Supabase UUID). Convenience for callers that need it. */
  familyWalletId: string | null;
  refresh: () => Promise<void>;
}

interface OnChainState {
  admin: string;
  payment_token: string;
  percents: number[];
  members: { address: string }[];
  balances: bigint[];
  policy: SpendPolicy;
  pending: PendingRequest[];
}

/**
 * Lifts the polling lifecycle to a single caller so the page opens one watch.
 * Short-circuits setState when the retval XDR is byte-identical to the last
 * one — keeps object references stable across no-op polls so downstream
 * useEffects (e.g. form re-sync in PolicySettingsForm) don't re-fire every 3s.
 *
 * Cosmetic display data (wallet name, envelope labels, member name/emoji)
 * comes from Supabase via useFamilyDisplay; we merge it into the returned
 * shape so consumers keep accessing `state.wallet_name` etc as before.
 */
export function useWalletState(
  userAddress: string | null,
  contractId: string | null,
): UseWalletStateResult {
  const [onChain, setOnChain] = useState<OnChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump on every fetch; only the latest call may setState. Guards against
  // address flipping mid-fetch.
  const generationRef = useRef(0);
  const lastRetvalXdrRef = useRef<string | null>(null);
  // Highest `latestLedger` we've successfully applied. Soroban RPC's
  // simulateTransaction includes the ledger the snapshot came from; when
  // a fresh poll hits an under-replicated RPC node we sometimes see an
  // OLDER snapshot than the one already on screen. Without this guard the
  // dashboard flickers between pre- and post-deposit state for a few
  // seconds after a `deposit()` lands. Tracking the high-water mark and
  // ignoring lower-ledger snapshots stops the regression.
  const lastLedgerRef = useRef<number>(0);

  const display = useFamilyDisplay(contractId);
  // Depend on the stable refresh fn, not the whole display object — that
  // would churn every render and rebuild `refresh` (which TopBar et al.
  // receive as a prop), forcing downstream re-renders.
  const displayRefresh = display.refresh;

  const fetchState = useCallback(async () => {
    if (!userAddress || !contractId) return;
    const gen = ++generationRef.current;
    const server = getServer();

    // Only toggle loading on the first fetch — subsequent polls happen in the
    // background and shouldn't flicker the UI. Same reasoning for `error`:
    // we only set it on the catch path (which Object.is-skips a re-render when
    // the message hasn't changed) and clear it strictly after a successful
    // poll. Otherwise an uninitialized contract would flicker between the
    // init form and the loading screen every 3s.
    const isInitialFetch = lastRetvalXdrRef.current === null;
    if (isInitialFetch) setLoading(true);
    try {
      const source = simulateSourceAccount();
      const contract = new Contract(contractId);
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK.passphrase,
      })
        .addOperation(contract.call("get_state"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (gen !== generationRef.current) return;
      if ("error" in sim) {
        throw new Error(`simulation failed: ${sim.error}`);
      }
      if (!sim.result?.retval) {
        throw new Error("simulation returned no value");
      }
      // Reject snapshots from a ledger we've already moved past — see the
      // lastLedgerRef comment above. The 0-ledger case is the first poll
      // for a wallet (no high-water mark yet) and always wins.
      const simLedger = Number(sim.latestLedger ?? 0);
      if (simLedger > 0 && simLedger < lastLedgerRef.current) {
        return;
      }
      const retvalXdr = sim.result.retval.toXDR("base64");
      if (retvalXdr === lastRetvalXdrRef.current) {
        return; // no-op poll; keep references stable
      }
      lastRetvalXdrRef.current = retvalXdr;
      lastLedgerRef.current = Math.max(lastLedgerRef.current, simLedger);
      const raw = scValToNative(sim.result.retval) as Record<string, unknown>;
      setOnChain(normalizeOnChainState(raw));
      setError(null);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generationRef.current && isInitialFetch) setLoading(false);
    }
  }, [userAddress, contractId]);

  // Reset the dedupe cache when the contractId changes so navigating between
  // Sobres always re-issues a fresh fetch.
  useEffect(() => {
    lastRetvalXdrRef.current = null;
    lastLedgerRef.current = 0;
    setOnChain(null);
    setError(null);
  }, [contractId]);

  useEffect(() => {
    if (!userAddress || !contractId) return;
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [userAddress, contractId, fetchState]);

  // Merge on-chain truth with Supabase-resident cosmetic state.
  const state = useMemo<WalletState | null>(() => {
    if (!onChain) return null;
    const members: Member[] = onChain.members.map((m) => {
      const d = display.membersByAddress.get(m.address);
      return {
        address: m.address,
        name: d?.name ?? "",
        emoji: d?.emoji ?? "",
      };
    });
    return {
      admin: onChain.admin,
      payment_token: onChain.payment_token,
      wallet_name: display.walletName,
      envelope_names: display.envelopeNames,
      percents: onChain.percents,
      members,
      balances: onChain.balances,
      policy: onChain.policy,
      pending: onChain.pending,
    };
  }, [onChain, display.walletName, display.envelopeNames, display.membersByAddress]);

  const refresh = useCallback(async () => {
    await fetchState();
    await displayRefresh();
  }, [fetchState, displayRefresh]);

  return {
    state,
    loading,
    error,
    familyWalletId: display.familyWalletId,
    refresh,
  };
}

function normalizeOnChainState(raw: Record<string, unknown>): OnChainState {
  const rawPolicy = (raw.policy ?? {}) as Record<string, unknown>;
  const optBigint = (v: unknown): bigint | null =>
    v === undefined || v === null ? null : (v as bigint);
  const policy: SpendPolicy = {
    require_all_sigs: Boolean(rawPolicy.require_all_sigs),
    daily_limit: optBigint(rawPolicy.daily_limit),
    per_tx_threshold: optBigint(rawPolicy.per_tx_threshold),
    protected_envelopes: Array.isArray(rawPolicy.protected_envelopes)
      ? (rawPolicy.protected_envelopes as unknown[]).map((e) =>
          envelopeNameFromScNative(e),
        )
      : [],
  };

  const pending: PendingRequest[] = Array.isArray(raw.pending)
    ? (raw.pending as Record<string, unknown>[]).map((r) => ({
        id: r.id as bigint,
        caller: String(r.caller),
        envelope: envelopeNameFromScNative(r.envelope),
        amount: r.amount as bigint,
        memo: String(r.memo ?? ""),
        requested_at_ledger: Number(r.requested_at_ledger ?? 0),
      }))
    : [];

  const members: { address: string }[] = Array.isArray(raw.members)
    ? (raw.members as Record<string, unknown>[]).map((m) => ({
        address: String(m.address),
      }))
    : [];

  return {
    admin: String(raw.admin),
    payment_token: String(raw.payment_token),
    percents: (raw.percents as number[]) ?? [],
    members,
    balances: (raw.balances as bigint[]) ?? [],
    policy,
    pending,
  };
}
