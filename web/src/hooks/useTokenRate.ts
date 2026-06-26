"use client";

import { useEffect, useState } from "react";

import {
  PAYMENT_TOKEN,
  PHP_PER_TOKEN_FALLBACK,
  type PaymentToken,
} from "@/lib/config";

const POLL_MS = 60_000;

interface PriceResponse {
  currency: PaymentToken;
  price: number;
  fetched_at: string;
  cached?: boolean;
  fallback?: boolean;
  mock?: boolean;
  error?: string;
}

export interface TokenRate {
  /** Current PHP-per-token rate. Starts at the hardcoded fallback so the UI
   *  never paints "₱0" while the first request is in flight. */
  phpPerToken: number;
  /** "XLM" or "USDC". Driven by the global PAYMENT_TOKEN config. */
  currency: PaymentToken;
  /** ISO timestamp of the last successful fetch (or fallback time at boot). */
  fetchedAt: string;
  /** True while we're still on the bootstrap fallback — no PDAX call has
   *  succeeded yet for this session. Useful for tagging the displayed amount
   *  as approximate in the modal. */
  initial: boolean;
}

/**
 * Polls `/api/pdax/price` every 60s for the live PHP-per-token rate. The
 * route caches server-side at 30s so we hit PDAX at most ~2x/minute even if
 * three different components mount the hook.
 *
 * The hook always returns a usable rate — bootstrap value is the hardcoded
 * fallback (see lib/config.ts) so the first paint has a sensible number.
 */
export function useTokenRate(): TokenRate {
  const [rate, setRate] = useState<TokenRate>({
    phpPerToken: PHP_PER_TOKEN_FALLBACK[PAYMENT_TOKEN],
    currency: PAYMENT_TOKEN,
    fetchedAt: new Date(0).toISOString(),
    initial: true,
  });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/pdax/price");
        if (!res.ok) return;
        const json = (await res.json()) as PriceResponse;
        if (cancelled) return;
        if (!Number.isFinite(json.price) || json.price <= 0) return;
        setRate({
          phpPerToken: json.price,
          currency: json.currency,
          fetchedAt: json.fetched_at,
          initial: false,
        });
      } catch {
        // network errors are non-fatal; keep the last known rate
      }
    };
    void tick();
    const t = setInterval(() => {
      if (!cancelled) void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return rate;
}
