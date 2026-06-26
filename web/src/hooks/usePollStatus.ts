"use client";

import { useEffect } from "react";

/**
 * Fire `GET <url>` on an interval while `enabled` is true. Each tick is a
 * single-shot state-machine kick — both the PDAX deposit and withdraw
 * modals use this to drive their server-side pipelines forward; the
 * actual state transitions surface via Supabase Realtime, not this hook's
 * return value.
 *
 * Cadence is 3s rather than 1s because each tick fans into Supabase reads,
 * a Supabase auth round-trip, and (often) PDAX OAuth + Horizon — faster
 * cadence adds up fast without buying meaningful wall-clock latency, since
 * the next-state transitions are PDAX-side processing (a few seconds each),
 * not chain confirmation.
 */
export function usePollStatus(url: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await fetch(url);
      } catch {
        // best effort; next tick retries
      }
    };
    void tick();
    const t = setInterval(() => {
      if (!cancelled) void tick();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [url, enabled]);
}
