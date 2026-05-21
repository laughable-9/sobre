"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  WatchWalletChanges,
} from "@stellar/freighter-api";

export type WalletStatus =
  | "checking"
  | "not-installed"
  | "disconnected"
  | "connected"
  | "error";

export interface FreighterState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  error: string | null;
  connect: () => Promise<void>;
}

/**
 * Single source of truth for the user's Freighter wallet connection.
 * - On mount, detects whether Freighter is installed and previously authorized.
 * - Exposes a connect() that triggers the wallet's permission popup.
 * - Watches for account/network changes via the SDK's WatchWalletChanges class.
 */
export function useFreighter(): FreighterState {
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { isConnected: installed } = await isConnected();
        if (cancelled) return;
        if (!installed) {
          setStatus("not-installed");
          return;
        }

        const { isAllowed: allowed } = await isAllowed();
        if (cancelled) return;
        if (!allowed) {
          setStatus("disconnected");
          return;
        }

        const [{ address: addr }, { network: net }] = await Promise.all([
          getAddress(),
          getNetwork(),
        ]);
        if (cancelled) return;
        setAddress(addr);
        setNetwork(net);
        setStatus("connected");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    const watcher = new WatchWalletChanges(2000);
    watcher.watch(({ address: addr, network: net }) => {
      setAddress(addr);
      setNetwork(net);
    });
    return () => watcher.stop();
  }, [status]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const { address: addr, error: requestErr } = await requestAccess();
      if (requestErr) {
        setError(requestErr.message ?? "Freighter denied the request.");
        return;
      }
      const { network: net } = await getNetwork();
      setAddress(addr);
      setNetwork(net);
      setStatus("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  return { status, address, network, error, connect };
}
