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
  disconnect: () => void;
  /** Re-query Freighter for the live address + network. WatchWalletChanges
   *  already polls every 2s in the background; this is for "force a refresh
   *  now" UX (e.g., after the user switches accounts inside Freighter). */
  refresh: () => Promise<void>;
}

/**
 * Freighter's API has no programmatic disconnect — the extension stays
 * authorized to the site until the user revokes via Freighter UI. We fake a
 * disconnect by setting a localStorage flag that the mount-time auto-detect
 * respects; `connect()` clears the flag.
 */
const DISCONNECT_FLAG_KEY = "sobre.wallet.disconnected";

function readDisconnectFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISCONNECT_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDisconnectFlag(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(DISCONNECT_FLAG_KEY, "1");
    else window.localStorage.removeItem(DISCONNECT_FLAG_KEY);
  } catch {
    // ignore quota issues
  }
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

        // Respect a user-initiated disconnect: even though Freighter still
        // remembers us, we present as logged out until the user clicks
        // Connect again.
        if (readDisconnectFlag()) {
          setStatus("disconnected");
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
    writeDisconnectFlag(false);
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

  const disconnect = useCallback(() => {
    writeDisconnectFlag(true);
    setAddress(null);
    setNetwork(null);
    setError(null);
    setStatus("disconnected");
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [{ address: addr }, { network: net }] = await Promise.all([
        getAddress(),
        getNetwork(),
      ]);
      setAddress(addr);
      setNetwork(net);
      setStatus("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { status, address, network, error, connect, disconnect, refresh };
}
