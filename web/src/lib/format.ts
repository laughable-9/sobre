/**
 * Display formatters shared across components. Pure functions, no React.
 */

import { STROOPS_PER_XLM, type EnvelopeName } from "@/lib/config";
import { getPhpPerXlm } from "@/lib/usePhpPerXlm";

/**
 * `Envelope::Groceries` and friends are encoded by Soroban as either a
 * `Vec<Symbol>` (the literal `#[contracttype] enum X` representation, where
 * scValToNative gives `["Groceries"]`) or a bare `Symbol` (when emitted as an
 * event topic, gives `"Groceries"`). Normalize either shape.
 */
export function envelopeNameFromScNative(
  raw: unknown,
  fallback: EnvelopeName = "Groceries",
): EnvelopeName {
  if (typeof raw === "string") return raw as EnvelopeName;
  if (Array.isArray(raw) && raw.length > 0) return String(raw[0]) as EnvelopeName;
  return fallback;
}

/** "GAVM…WWA2" from a full Stellar G-address. */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Stroops (the on-chain native unit) → XLM. */
export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / STROOPS_PER_XLM;
}

/** "3.0000 XLM" — for inline use inside larger sentences. */
export function formatXlm(stroops: bigint): string {
  return `${stroopsToXlm(stroops).toFixed(4)} XLM`;
}

/** "₱48.00" — fiat conversion using the live CoinGecko rate (fallback in
 *  config.ts on cold boot / network failure). */
export function formatPhp(stroops: bigint): string {
  return `₱${(stroopsToXlm(stroops) * getPhpPerXlm()).toFixed(2)}`;
}

/** "₱1,234.56" — same as formatPhp but with Filipino locale grouping. */
export function formatPhpLocale(stroops: bigint): string {
  const php = stroopsToXlm(stroops) * getPhpPerXlm();
  return `₱${php.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
