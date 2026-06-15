/**
 * Mirrors web/src/lib/usePhpPerXlm.ts. Two differences from the web version:
 *
 * 1. AsyncStorage instead of localStorage for the cached rate.
 * 2. Calls CoinGecko directly instead of going through /api/php-rate. The
 *    web proxy exists because many browser clients hitting CoinGecko from
 *    one Vercel origin would blow through the free-tier rate limit; that
 *    N-clients-one-origin problem doesn't apply the same way to a mobile
 *    app, where each device calls CoinGecko independently regardless.
 *    Revisit if CoinGecko rate limits become an issue at scale.
 */

import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { PHP_PER_XLM as FALLBACK } from "./config";

let currentRate = FALLBACK;
const subscribers = new Set<() => void>();

function setRate(next: number) {
  if (!Number.isFinite(next) || next <= 0) return;
  if (next === currentRate) return;
  currentRate = next;
  subscribers.forEach((cb) => cb());
}

/** For non-React call sites (lib/format.ts). */
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
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=php";

interface CachedRate {
  rate: number;
  ts: number;
}

async function readCache(): Promise<CachedRate | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedRate;
    if (Date.now() - c.ts > CACHE_TTL_MS) return null;
    if (!Number.isFinite(c.rate) || c.rate <= 0) return null;
    return c;
  } catch {
    return null;
  }
}

async function writeCache(rate: number) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rate, ts: Date.now() }));
  } catch {
    /* quota; ignore */
  }
}

interface CoingeckoResponse {
  stellar?: { php?: number };
}

async function fetchLiveRate(): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as CoingeckoResponse;
    const live = data?.stellar?.php;
    if (typeof live !== "number" || !Number.isFinite(live) || live <= 0) {
      return null;
    }
    return live;
  } catch {
    return null;
  }
}

/** Mount once near the app root (see App.tsx). Reads the cached rate from
 *  AsyncStorage for the first render, then always revalidates against
 *  CoinGecko in the background. */
export function PhpRateBoot(): null {
  useEffect(() => {
    void (async () => {
      const cached = await readCache();
      if (cached) setRate(cached.rate);
      const live = await fetchLiveRate();
      if (live !== null) {
        setRate(live);
        void writeCache(live);
      }
    })();
  }, []);
  return null;
}
