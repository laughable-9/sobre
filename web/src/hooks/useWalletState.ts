"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";

import { NETWORK, type EnvelopeName } from "@/lib/config";
import { getServer, simulateSourceAccount } from "@/lib/contract";
import { envelopeNameFromScNative } from "@/lib/format";

export interface SpendPolicy {
  require_all_sigs: boolean;
  daily_limit: bigint | null;
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
  name: string;
  emoji: string;
}

export interface WalletState {
  admin: string;
  payment_token: string;
  wallet_name: string;
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
  refresh: () => Promise<void>;
}

/**
 * Lifts the polling lifecycle to a single caller so the page opens one watch.
 * Short-circuits setState when the retval XDR is byte-identical to the last
 * one — keeps object references stable across no-op polls so downstream
 * useEffects (e.g. form re-sync in PolicySettingsForm) don't re-fire every 3s.
 */
export function useWalletState(
  userAddress: string | null,
  contractId: string | null,
): UseWalletStateResult {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump on every fetch; only the latest call may setState. Guards against
  // address flipping mid-fetch.
  const generationRef = useRef(0);
  const lastRetvalXdrRef = useRef<string | null>(null);

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
      const retvalXdr = sim.result.retval.toXDR("base64");
      if (retvalXdr === lastRetvalXdrRef.current) {
        return; // no-op poll; keep references stable
      }
      lastRetvalXdrRef.current = retvalXdr;
      const raw = scValToNative(sim.result.retval) as Record<string, unknown>;
      setState(normalizeWalletState(raw));
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
    setState(null);
    setError(null);
  }, [contractId]);

  useEffect(() => {
    if (!userAddress || !contractId) return;
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [userAddress, contractId, fetchState]);

  return { state, loading, error, refresh: fetchState };
}

function normalizeWalletState(raw: Record<string, unknown>): WalletState {
  const rawPolicy = (raw.policy ?? {}) as Record<string, unknown>;
  const policy: SpendPolicy = {
    require_all_sigs: Boolean(rawPolicy.require_all_sigs),
    daily_limit:
      rawPolicy.daily_limit === undefined || rawPolicy.daily_limit === null
        ? null
        : (rawPolicy.daily_limit as bigint),
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

  const members: Member[] = Array.isArray(raw.members)
    ? (raw.members as Record<string, unknown>[]).map((m) => ({
        address: String(m.address),
        name: String(m.name ?? ""),
        emoji: String(m.emoji ?? ""),
      }))
    : [];

  return {
    admin: String(raw.admin),
    payment_token: String(raw.payment_token),
    wallet_name: String(raw.wallet_name ?? ""),
    envelope_names: Array.isArray(raw.envelope_names)
      ? (raw.envelope_names as unknown[]).map(String)
      : [],
    percents: (raw.percents as number[]) ?? [],
    members,
    balances: (raw.balances as bigint[]) ?? [],
    policy,
    pending,
  };
}
