"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";

import { CONTRACT_ID, NETWORK } from "@/lib/config";
import { getServer } from "@/lib/contract";

export interface WalletState {
  admin: string;
  payment_token: string;
  percents: number[];
  members: string[];
  balances: bigint[];
}

export interface UseWalletStateResult {
  state: WalletState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Poll `get_state` on the deployed contract every 3 seconds using
 * simulateTransaction (no fees, no tx submission). Uses the connected user's
 * address as the simulation source. Lift this hook to the root component so
 * the page polls once, not once per consumer.
 */
export function useWalletState(
  userAddress: string | null,
): UseWalletStateResult {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each call to fetchState bumps this; only the latest call is allowed to
  // setState. Protects against userAddress flipping mid-fetch.
  const generationRef = useRef(0);

  const fetchState = useCallback(async () => {
    if (!userAddress) return;
    const gen = ++generationRef.current;
    const server = getServer();

    setLoading(true);
    setError(null);
    try {
      const source = await server.getAccount(userAddress);
      const contract = new Contract(CONTRACT_ID);
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
      const native = scValToNative(sim.result.retval) as WalletState;
      setState(native);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress) return;
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [userAddress, fetchState]);

  return { state, loading, error, refresh: fetchState };
}
