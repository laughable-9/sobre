"use client";

import { useEffect, useSyncExternalStore } from "react";

import { PHP_PER_XLM as FALLBACK } from "@/lib/config";

/** Live PHP-per-XLM rate. Backed by a module-level mutable so non-React
 *  utilities (lib/format.ts) read the same value as components, plus a
 *  subscriber set so the hook can trigger re-renders when CoinGecko comes
 *  back. Falls back to the hardcoded rate from config.ts on cold boot and
 *  on any network failure. */

let currentRate = FALLBACK;
const subscribers = new Set<() => void>();

function setRate(next: number) {
  if (!Number.isFinite(next) || next <= 0) return;
  if (next === currentRate) return;
  currentRate = next;
  subscribers.forEach((cb) => cb());
}

/** For non-React call sites (lib/format.ts, event handlers). */
export function getPhpPerXlm(): number {
  return currentRate;
}

/** For React components. Re-renders the caller when the rate flips. */
export function usePhpPerXlm(): number {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => currentRate,
    () => FALLBACK,
  );
}

const CACHE_KEY = "sobre.phpPerXlm";
const CACHE_TTL_MS = 10 * 60 * 1000;
/** Our own server route, which fronts CoinGecko with a 10-minute Vercel edge
 *  cache so the upstream sees one origin instead of N user-agents. */
const RATE_URL = "/api/php-rate";

interface CachedRate {
  rate: number;
  ts: number;
}

function readCache(): CachedRate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedRate;
    if (Date.now() - c.ts > CACHE_TTL_MS) return null;
    if (!Number.isFinite(c.rate) || c.rate <= 0) return null;
    return c;
  } catch {
    return null;
  }
}

function writeCache(rate: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ rate, ts: Date.now() }),
    );
  } catch {
    /* quota; ignore */
  }
}

async function fetchLiveRate(): Promise<number | null> {
  try {
    const res = await fetch(RATE_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as { rate?: number };
    const live = data?.rate;
    if (typeof live !== "number" || !Number.isFinite(live) || live <= 0) {
      return null;
    }
    return live;
  } catch {
    return null;
  }
}

/** Mount once in app/layout.tsx. Reads cached rate from localStorage for
 *  the first paint, then always revalidates against /api/php-rate in the
 *  background. The server route is edge-cached for 10 minutes so the
 *  background call is cheap either way; meanwhile the user never sees a
 *  stale rate older than one page load. */
export function PhpRateBoot(): null {
  useEffect(() => {
    const cached = readCache();
    if (cached) setRate(cached.rate);
    void fetchLiveRate().then((live) => {
      if (live !== null) {
        setRate(live);
        writeCache(live);
      }
    });
  }, []);
  return null;
}
