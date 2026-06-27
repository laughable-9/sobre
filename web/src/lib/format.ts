/**
 * Display formatters shared across components. Pure functions, no React.
 */

import {
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  type EnvelopeName,
} from "@/lib/config";

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

/** "•••1461" from a bank account number. Preserves the last 4 chars. */
export function maskAccountNumber(account: string): string {
  return account.replace(/.(?=.{4})/g, "•");
}

/** Stroops (the on-chain sub-unit) → USDC. SAC tokens on Stellar use 7
 *  decimals (10^7 stroops per token). */
export function stroopsToUsdc(stroops: bigint): number {
  return Number(stroops) / STROOPS_PER_USDC;
}

/** "3.0000 USDC" — for inline use inside larger sentences. */
export function formatUsdc(stroops: bigint): string {
  return `${stroopsToUsdc(stroops).toFixed(4)} USDC`;
}

/** "₱48.00" — fiat conversion using the demo USDC→PHP rate. */
export function formatPhp(stroops: bigint): string {
  return `₱${(stroopsToUsdc(stroops) * PHP_PER_USDC).toFixed(2)}`;
}

/** "₱1,234.56" — same as formatPhp but with Filipino locale grouping. */
export function formatPhpLocale(stroops: bigint): string {
  const php = stroopsToUsdc(stroops) * PHP_PER_USDC;
  return `₱${php.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "₱1,234" — Filipino locale grouping, no decimals. Use for budget /
 *  threshold / limit labels where cents would clutter the value. */
export function formatPhpInt(stroops: bigint | null): string {
  if (stroops === null) return "no limit";
  const php = stroopsToUsdc(stroops) * PHP_PER_USDC;
  return `₱${php.toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
