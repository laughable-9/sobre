"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AdminMetrics {
  sobresCount: number;
  usersCount: number;
  tvlUsdc: number;
  avgSobreUsdc: number;
  medianSobreUsdc: number;
  retentionRate: number | null;
  retainedCount: number;
  matureSobresCount: number;
  activeSobresCount: number;
  activeSobresPrevCount: number;
  activeSobresDeltaPct: number | null;
  recentTxCount: number;
  recentTxCountDeltaPct: number | null;
  recentInflowUsdc: number;
  recentInflowDeltaPct: number | null;
  recentOutflowUsdc: number;
  recentOutflowDeltaPct: number | null;
  activityPriorPeriodAvailable: boolean;
  netFlowUsdc: number;
  activityWindowLedgers: number;
  sobresCreatedThisPeriod: number;
  sobresCreatedPrevPeriod: number;
  sobresCreatedDeltaPct: number | null;
  sobresCreatedByDay: { day: string; count: number }[];
  computedAt: string;
}

/** 60s matches the server-side cache TTL in /api/admin/metrics — polling
 *  faster would just re-fetch the same cached response. */
const POLL_MS = 60_000;

/**
 * Fetches /api/admin/metrics and polls it. 403 (not a platform admin) and
 * other errors are both surfaced via `error` — the page renders one or the
 * other, never a silent blank state. `refresh()` forces a recompute past
 * the server-side cache (?refresh=1) for a manual "reload" action.
 */
export function useAdminMetrics(): {
  metrics: AdminMetrics | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const fetchOnce = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const url = opts?.force
        ? "/api/admin/metrics?refresh=1"
        : "/api/admin/metrics";
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (cancelledRef.current) return;
      if (!res.ok) {
        setError(
          (body && typeof body.error === "string" && body.error) ||
            `Request failed (${res.status})`,
        );
        return;
      }
      setMetrics(body as AdminMetrics);
      setError(null);
    } catch (e) {
      if (cancelledRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount external-sync effect (same pattern as
    // useFamilyWalletContractIds): the async body owns its own setState
    // calls in a finally, so nothing runs synchronously inside the effect.
    cancelledRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOnce();
    const interval = setInterval(() => void fetchOnce(), POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [fetchOnce]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOnce({ force: true });
    if (!cancelledRef.current) setRefreshing(false);
  }, [fetchOnce]);

  return { metrics, loading, refreshing, error, refresh };
}
