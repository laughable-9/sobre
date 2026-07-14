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

/** "KP" from "Kyle Pagunsan", "AI" from "Airi", "?" from "". Used by the
 *  Avatar fallback tile when no Google profile picture is available. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

/** "just now" / "5m ago" / "3h ago" / "2d ago" — shared by the activity
 *  surfaces (EnvelopeCard blurb, HouseholdSummary mini feed). */
export function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Hoisted so the RegExp isn't recompiled on every catch. Match order
// matters — the WebAuthn "not allowed" line is the biggest offender we
// want to normalize before any tail URL cleanup fires.
const RX_WEBAUTHN =
  /NotAllowedError|operation either timed out or was not allowed|webauthn/i;
const RX_ABORT = /AbortError/i;
const RX_INVALID_STATE = /InvalidStateError/i;
const RX_NETWORK = /NetworkError|Failed to fetch/i;
const RX_TRAILING_SEE_URL = /\s*See:\s*https?:\/\/\S+\s*$/i;
const RX_TRAILING_URL = /\s+https?:\/\/\S+\s*$/i;

/** Map raw browser / passkey errors to a message a non-technical family
 *  admin can act on. Accepts either the caught `unknown` or a
 *  pre-extracted string. WebAuthn errors are the biggest offender — they
 *  include a spec URL that reads as spam in a toast. Anything unmatched
 *  falls through with its own message strip-cleaned of trailing spec
 *  URLs so the truncation strategy on the toast has less to hide. */
export function friendlyError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const s = raw.trim();
  if (RX_WEBAUTHN.test(s)) return "Face ID was cancelled or timed out";
  if (RX_ABORT.test(s)) return "Cancelled";
  if (RX_INVALID_STATE.test(s)) {
    return "This device isn't set up for this passkey";
  }
  if (RX_NETWORK.test(s)) return "Network hiccup. Try again in a moment.";
  return s.replace(RX_TRAILING_SEE_URL, "").replace(RX_TRAILING_URL, "");
}

/** "Nov 8, 3:42 PM" — short absolute timestamp used by activity rows in
 *  the sub-account panels. Falls back to "" on unparseable input so a
 *  broken ledger timestamp doesn't blow up the render. */
export function formatShortDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** "2026/07/13" — date-only sibling to formatShortDateTime. Used on the
 *  receipt detail sheet header for "Date:" and "Added:". Same graceful
 *  fallback on unparseable input. */
export function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Loose v4-UUID validator used by every API route that takes a UUID from
 *  the URL or a JSON body. Cheap regex — not a full parse. */
export function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/** Coerce a wire value (JSON transport) into stroops. Accepts bigint,
 *  finite number, or all-digit string. Returns null on anything else so
 *  callers can distinguish "not supplied" from "zero". */
export function toStroops(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.round(v));
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}

/** "47h 12m 3s" / "5m 3s" / "0s" — future-tense sibling to relativeTime, for
 *  countdown surfaces (Grow request unlock timers). Skips zero hour/minute
 *  fields when they'd read as noise ("3s" not "0h 0m 3s"), keeps them when
 *  a higher unit is present ("47h 0m 3s" reads honestly). */
export function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, Math.floor(secondsLeft));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

/** Parses a user-typed PHP amount string ("1,234.56" or "1234.56") to
 *  payment-token stroops. Returns 0n on empty / invalid input. Strips
 *  commas so paste-from-currency-formatted works cleanly. Rounds via
 *  Math.round so a fractional stroop doesn't sneak past the i128
 *  boundary. */
export function phpToStroops(raw: string): bigint {
  const clean = raw.replace(/,/g, "").trim();
  const php = Number(clean);
  if (!Number.isFinite(php) || php <= 0) return 0n;
  const tokens = php / PHP_PER_USDC;
  const stroops = Math.round(tokens * STROOPS_PER_USDC);
  return stroops > 0 ? BigInt(stroops) : 0n;
}

/** Formats a stroop amount as PHP or USD based on the caller's currency
 *  choice (usually from useCurrency()). Uses tabular locale grouping so
 *  columns of values align in monospace-numeral flows. */
export function formatCurrencyLocale(
  stroops: bigint,
  currency: "PHP" | "USD",
): string {
  const usd = stroopsToUsdc(stroops);
  if (currency === "USD") {
    return `$${usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `₱${(usd * PHP_PER_USDC).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Adaptive-precision formatter for interest micro-accrual. Under 1
 *  cent of display currency, expands to 6 decimal places so the value
 *  still reads as non-zero — a fresh Earn/Grow position that hasn't
 *  had time to accrue a full cent otherwise displays as "$0.00" even
 *  though the underlying stroops are strictly positive, which reads
 *  as "broken" instead of "penny still cooking". Above 1 cent, falls
 *  through to normal 2-decimal money display. */
export function formatInterestCurrencyLocale(
  stroops: bigint,
  currency: "PHP" | "USD",
): string {
  const usd = stroopsToUsdc(stroops);
  const displayVal = currency === "USD" ? usd : usd * PHP_PER_USDC;
  const decimals = displayVal > 0 && displayVal < 0.01 ? 6 : 2;
  const symbol = currency === "USD" ? "$" : "₱";
  const locale = currency === "USD" ? "en-US" : "en-PH";
  return `${symbol}${displayVal.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
