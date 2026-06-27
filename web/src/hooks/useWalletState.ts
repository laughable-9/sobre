"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";

import { NETWORK } from "@/lib/config";
import { getServer, simulateSourceAccount, type SpendPolicyShape } from "@/lib/contract";
import { useFamilyDisplay } from "@/hooks/useFamilyDisplay";

export interface Member {
  address: string;
  name: string;
  emoji: string;
  /** Supabase `wallets.id` — handy when a downstream mutation needs to
   *  reference the member's row without a fresh contract_id → id lookup. */
  walletDbId: string | null;
}

export interface WalletState {
  admin: string;
  payment_token: string;
  /** Wallet display name (Supabase). */
  wallet_name: string;
  /** Envelope display labels (Supabase). */
  envelope_names: string[];
  /** Per-envelope split percentages (Supabase). Indexed [Groceries, Tuition, Savings]. */
  percents: [number, number, number];
  /** On-chain members. Joined with Supabase display data (name + emoji + walletDbId). */
  members: Member[];
  /** On-chain envelope balances in stroops. */
  balances: bigint[];
  /** Family policy (Supabase). Frontend gates spends against this. */
  policy: SpendPolicyShape;
}

export interface UseWalletStateResult {
  state: WalletState | null;
  loading: boolean;
  error: string | null;
  familyWalletId: string | null;
  refresh: () => Promise<void>;
}

interface OnChainState {
  admin: string;
  payment_token: string;
  members: { address: string }[];
  balances: bigint[];
}

/**
 * Polls the contract's `get_state` for the on-chain truth (admin, members'
 * addresses, balances) and joins it with the Supabase-resident display +
 * family-rule state from useFamilyDisplay (wallet name, envelope labels,
 * percents, policy, member name/emoji).
 */
export function useWalletState(
  userAddress: string | null,
  contractId: string | null,
): UseWalletStateResult {
  const [onChain, setOnChain] = useState<OnChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const lastRetvalXdrRef = useRef<string | null>(null);
  const lastLedgerRef = useRef<number>(0);

  const display = useFamilyDisplay(contractId);
  const displayRefresh = display.refresh;

  const fetchState = useCallback(async () => {
    if (!userAddress || !contractId) return;
    const gen = ++generationRef.current;
    const server = getServer();

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
      if ("error" in sim) throw new Error(`simulation failed: ${sim.error}`);
      if (!sim.result?.retval) throw new Error("simulation returned no value");

      const simLedger = Number(sim.latestLedger ?? 0);
      if (simLedger > 0 && simLedger < lastLedgerRef.current) return;

      const retvalXdr = sim.result.retval.toXDR("base64");
      if (retvalXdr === lastRetvalXdrRef.current) return;

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

  const state = useMemo<WalletState | null>(() => {
    if (!onChain) return null;
    const members: Member[] = onChain.members.map((m) => {
      const d = display.membersByAddress.get(m.address);
      return {
        address: m.address,
        name: d?.name ?? "",
        emoji: d?.emoji ?? "",
        walletDbId: d?.walletDbId ?? null,
      };
    });
    return {
      admin: onChain.admin,
      payment_token: onChain.payment_token,
      wallet_name: display.walletName,
      envelope_names: display.envelopeNames,
      percents: display.percents,
      members,
      balances: onChain.balances,
      policy: display.policy,
    };
  }, [
    onChain,
    display.walletName,
    display.envelopeNames,
    display.percents,
    display.policy,
    display.membersByAddress,
  ]);

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
  const members: { address: string }[] = Array.isArray(raw.members)
    ? (raw.members as Record<string, unknown>[]).map((m) => ({
        address: String(m.address),
      }))
    : [];
  return {
    admin: String(raw.admin),
    payment_token: String(raw.payment_token),
    members,
    balances: (raw.balances as bigint[]) ?? [],
  };
}
