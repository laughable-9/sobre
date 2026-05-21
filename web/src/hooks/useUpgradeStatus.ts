"use client";

import { useCallback, useEffect, useState } from "react";

import { FACTORY_CONTRACT_ID } from "@/lib/config";
import { fetchRunningWasmHash, simulateRead } from "@/lib/contract";

export interface UpgradeStatus {
  /** Hex-encoded wasm hash this Sobre is currently running. */
  runningHash: string | null;
  /** Hex-encoded wasm hash the factory considers canonical. */
  currentHash: string | null;
  /** runningHash !== currentHash, both known. */
  updateAvailable: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Compares this Sobre's executing wasm hash to the factory's canonical
 *  pointer. The factory hash needs an authenticated source for the simulate
 *  call (anyone connected works), so pass any connected address. */
export function useUpgradeStatus(
  contractId: string | null,
  callerAddress: string | null,
): UpgradeStatus {
  const [runningHash, setRunningHash] = useState<string | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!contractId || !callerAddress) return;
    setError(null);
    try {
      const [running, currentBytes] = await Promise.all([
        fetchRunningWasmHash(contractId),
        simulateRead<Buffer | Uint8Array>(
          FACTORY_CONTRACT_ID,
          "current_sobre_wasm",
          [],
          callerAddress,
        ),
      ]);
      setRunningHash(running);
      // scValToNative decodes a Bytes value into a Buffer-ish array. Normalize
      // to lowercase hex so the equality check below is meaningful.
      const buf =
        currentBytes instanceof Uint8Array
          ? currentBytes
          : new Uint8Array(currentBytes);
      const hex = Array.from(buf)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setCurrentHash(hex);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contractId, callerAddress]);

  useEffect(() => {
    setLoading(true);
    void fetchOnce();
  }, [fetchOnce]);

  const updateAvailable = Boolean(
    runningHash && currentHash && runningHash !== currentHash,
  );

  return {
    runningHash,
    currentHash,
    updateAvailable,
    loading,
    error,
    refresh: fetchOnce,
  };
}
