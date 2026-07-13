"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { FACTORY_CONTRACT_ID } from "@/lib/config";
import { simulateRead } from "@/lib/contract";

export interface UseSobresOfAdminResult {
  sobres: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Polls SobreFactory.sobres_of_admin(adminAddress) for the user's admin-owned
 * wallets. Returned addresses are SobreContract instances the caller can
 * navigate to via /dashboard/<address>. The directory only mutates when the
 * connected user calls create_sobre, so the polling cadence is sparse — and
 * useCreateSobre callers should `refresh()` immediately after success rather
 * than rely on the next tick.
 */
export function useSobresOfAdmin(
  adminAddress: string | null,
): UseSobresOfAdminResult {
  const [sobres, setSobres] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!adminAddress) {
      setSobres([]);
      return;
    }
    const initial = sobres.length === 0;
    if (initial) setLoading(true);
    try {
      const args = [Address.fromString(adminAddress).toScVal()];
      const raw = await simulateRead<string[]>(
        FACTORY_CONTRACT_ID,
        "sobres_of_admin",
        args,
      );
      setSobres(Array.isArray(raw) ? raw.map((a) => String(a)) : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (initial) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminAddress]);

  useEffect(() => {
    // Polling driver — refresh feeds setState from an RPC call.
    // Intentional external-sync effect.
    if (!adminAddress) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [adminAddress, refresh]);

  return { sobres, loading, error, refresh };
}
