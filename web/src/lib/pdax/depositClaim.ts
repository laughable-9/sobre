/**
 * Atomic-claim helpers for the pdax_deposits state machine.
 *
 * Background: `withdraw_tx_hash` does double duty on this table — it ends
 * up holding the real SAC transfer hash once phase 2 completes, but it's
 * also used as a transient "I'm in flight" sentinel while a poll-status
 * tick is mid-PDAX-trade (`advanceFromPending`) or mid-SAC-transfer
 * (`advanceFromFunded`), and while the /active route's self-heal pass
 * resurrects a cancelled-but-paid row.
 *
 * The original `withdraw_tx_hash='claiming'` literal had no TTL, so any
 * handler that died between SET and RESET (Vercel 60s timeout, container
 * crash, abort signal) deadlocked the row forever — /cancel refused
 * because the sentinel wasn't NULL, and no future poll could re-claim
 * because the claim required `IS NULL`. The row sat at status=pending
 * with no recovery path.
 *
 * Fix: encode the claim as `claiming:<isoTimestamp>`. A future tick can
 * parse the timestamp and steal the claim if it's older than CLAIM_TTL_MS.
 * Cancel applies the same staleness rule before refusing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** How long a held claim is considered valid before another tick may
 *  steal it. 60s is well over the worst-case happy-path duration
 *  (kickOffPdaxWithdraw + trade settlement runs ~10-30s) and matches the
 *  Vercel function timeout, so a process that's still alive will have
 *  released the claim by then. */
export const CLAIM_TTL_MS = 60_000;

const CLAIM_PREFIX = "claiming:";

/** Build a fresh claim value stamped with the current ISO timestamp. */
export function mintClaim(): string {
  return `${CLAIM_PREFIX}${new Date().toISOString()}`;
}

/** True if `value` looks like a claim sentinel that has aged past the
 *  TTL. Real settlement hashes never match the prefix, so this is a
 *  safe shape check. */
export function isStaleClaim(value: string | null): boolean {
  if (!value || !value.startsWith(CLAIM_PREFIX)) return false;
  const isoPart = value.slice(CLAIM_PREFIX.length);
  const stampMs = new Date(isoPart).getTime();
  if (Number.isNaN(stampMs)) return true;
  return Date.now() - stampMs >= CLAIM_TTL_MS;
}

/** True if `value` looks like a claim and is still within TTL (in flight). */
export function isFreshClaim(value: string | null): boolean {
  if (!value || !value.startsWith(CLAIM_PREFIX)) return false;
  return !isStaleClaim(value);
}

/**
 * Try to atomically acquire the claim sentinel on a pdax_deposits row
 * at the given `requiredStatus`. Returns the claim string on success,
 * or `null` if another tick holds a fresh claim, the row isn't at the
 * expected status, or the row doesn't exist.
 *
 * Path A — fresh claim from NULL: the common case. One round trip.
 * Path B — steal a stale claim: only fires when a previous handler died
 * holding the sentinel. Reads the row to learn the exact stale value,
 * then atomic-CAS on it.
 *
 * Phase 1 of the deposit pipeline gates on status='pending' (claim
 * before kickOffPdaxWithdraw). Phase 2 gates on status='funded' (claim
 * before the SAC transfer). Self-heal in /active calls a separate
 * resurrect-and-claim path because it also flips status.
 */
export async function acquireDepositClaim(
  admin: SupabaseClient,
  identifier: string,
  requiredStatus: "pending" | "funded",
): Promise<string | null> {
  const claim = mintClaim();
  const { data: fresh } = await admin
    .from("pdax_deposits")
    .update({ withdraw_tx_hash: claim })
    .eq("identifier", identifier)
    .eq("status", requiredStatus)
    .is("withdraw_tx_hash", null)
    .select("identifier");
  if (fresh?.length) return claim;

  const { data: row } = await admin
    .from("pdax_deposits")
    .select("status, withdraw_tx_hash")
    .eq("identifier", identifier)
    .maybeSingle();
  if (!row) return null;
  const r = row as { status: string; withdraw_tx_hash: string | null };
  if (r.status !== requiredStatus) return null;
  if (!isStaleClaim(r.withdraw_tx_hash)) return null;

  const { data: stolen } = await admin
    .from("pdax_deposits")
    .update({ withdraw_tx_hash: claim })
    .eq("identifier", identifier)
    .eq("status", requiredStatus)
    .eq("withdraw_tx_hash", r.withdraw_tx_hash)
    .select("identifier");
  return stolen?.length ? claim : null;
}

/**
 * Release the claim by clearing withdraw_tx_hash. Atomic on the exact
 * claim value so we never wipe a real settlement hash that landed under
 * us. Caller passes the value `acquireDepositClaim` returned.
 */
export async function releaseDepositClaim(
  admin: SupabaseClient,
  identifier: string,
  claim: string,
): Promise<void> {
  await admin
    .from("pdax_deposits")
    .update({ withdraw_tx_hash: null })
    .eq("identifier", identifier)
    .eq("withdraw_tx_hash", claim);
}

/** True when the cancel route should refuse — there's an in-flight claim
 *  that hasn't aged past TTL. Stale claims and a NULL withdraw_tx_hash
 *  both allow cancellation. */
export function claimBlocksCancel(value: string | null): boolean {
  return isFreshClaim(value);
}
