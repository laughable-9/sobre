/**
 * Display formatters shared across components. Pure functions, no React.
 */

import { PHP_PER_XLM, STROOPS_PER_XLM, type EnvelopeName } from "@/lib/config";

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

/** "₱48.00" — fiat conversion using the demo's hardcoded XLM→PHP rate. */
export function formatPhp(stroops: bigint): string {
  return `₱${(stroopsToXlm(stroops) * PHP_PER_XLM).toFixed(2)}`;
}
