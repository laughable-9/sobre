"use client";

import { useEffect } from "react";

/**
 * Fire `GET <url>` on an interval while `enabled` is true. Each tick is a
 * single-shot state-machine kick — the PDAX deposit + withdraw modals
 * use this to drive their pipelines forward; state transitions surface
 * via Supabase Realtime, not this hook's return value.
 *
 * 3s cadence ramps to 8s after 60s, and skips ticks while the tab is
 * hidden, to stay under the 3000/day perUser rate limit.
 */
export function usePollStatus(url: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    let interval = 3000;
    const startedAt = performance.now();
    const tick = async () => {
      if (document.hidden) return;
      try {
        await fetch(url);
      } catch {
        // best effort; next tick retries
      }
    };
    void tick();
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await tick();
        // Ramp from 3s → 8s after the first minute so a long-idle modal
        // doesn't burn the daily quota.
        if (performance.now() - startedAt > 60_000) interval = 8000;
        if (!cancelled) schedule();
      }, interval);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, enabled]);
}
