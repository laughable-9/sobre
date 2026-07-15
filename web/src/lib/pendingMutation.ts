"use client";

/**
 * Persistent resume checkpoints for client mutations that pair an on-chain
 * write with a follow-up off-chain step (Supabase mirror, server API POST,
 * etc). When the follow-up step fails after the on-chain step lands, the
 * caller reads back the checkpoint on retry and skips re-signing /
 * re-invoking on chain — which would either trap ("already member",
 * "invite exists") or waste a FaceID prompt.
 *
 * Storage is `localStorage`, not sessionStorage, so a checkpoint survives
 * tab close / browser restart. "My Sobres" hides orphan on-chain contracts
 * (see `useFamilyWalletContractIds`), so a user who closes the tab
 * mid-flow would otherwise never see the wallet they just paid to deploy.
 * A server-side recovery scan across on-chain state is the "real" bulletproof
 * fix; this covers the common case (same device, later session) cheaply.
 *
 * Bounded by a TTL so a permanently-broken mirror (RLS misconfig, deleted
 * family_wallet_id, wrong wasm) doesn't loop the same failure forever.
 * Default 24h matches `cashoutRecovery.ts`.
 *
 * Idiom mirrors `safeLocalStorage()` in `web/src/lib/profile.ts` — one
 * guard, then direct storage calls in the reader/writer.
 */

/** Default TTL for a checkpoint. After this age the read helper treats
 *  the slot as empty and clears it, so a stale entry can't strand the
 *  user in an infinite loop against a broken mirror. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Narrow an untrusted value to a keyed object. Shared entry-point for
 *  the shape-check that every `PendingSlot` validator starts with. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export interface PendingSlot<T> {
  /** Read the checkpoint for `owner` (usually the user's smart-wallet
   *  C-address). Returns null when no checkpoint is stored, storage is
   *  disabled, or the stored value fails validation. */
  read: (owner: string) => T | null;
  /** Overwrite the checkpoint for `owner`. Silently no-ops if storage is
   *  disabled — the caller's retry then costs a repeat on-chain step, which
   *  is the same fallback as before this helper existed. */
  write: (owner: string, value: T) => void;
  /** Drop the checkpoint for `owner`. Called after the full mutation
   *  succeeds so a fresh attempt starts from step 1. */
  clear: (owner: string) => void;
}

/** On-disk envelope wrapping the caller's value with the write timestamp.
 *  Read-side checks `Date.now() - savedAt > ttlMs` and treats a stale
 *  entry as absent. */
interface Envelope<T> {
  v: T;
  savedAt: number;
}

/**
 * Make a typed localStorage slot. `prefix` namespaces the mutation type
 * (e.g. `"sobre.pendingCreate"`); `owner` (passed per call) scopes to a
 * specific user so two accounts sharing a browser can't step on each
 * other's checkpoints. `validate` is a runtime shape check for the
 * parsed JSON — untrusted storage should never round-trip a partial value
 * into a full `T`.
 *
 * `ttlMs` bounds how long a stale checkpoint lingers before the read
 * helper treats it as absent (default 24h). Reads that hit an expired
 * entry also clear it, so the next attempt starts from step 1.
 */
export function makePendingSlot<T>(
  prefix: string,
  validate: (value: unknown) => value is T,
  opts?: { ttlMs?: number },
): PendingSlot<T> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const keyFor = (owner: string) => `${prefix}:${owner}`;
  return {
    read(owner) {
      const storage = safeLocalStorage();
      if (!storage) return null;
      try {
        const raw = storage.getItem(keyFor(owner));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed) || typeof parsed.savedAt !== "number") {
          return null;
        }
        if (Date.now() - parsed.savedAt > ttlMs) {
          try {
            storage.removeItem(keyFor(owner));
          } catch {
            // Best effort — the stale read still returns null below.
          }
          return null;
        }
        return validate(parsed.v) ? parsed.v : null;
      } catch {
        return null;
      }
    },
    write(owner, value) {
      const storage = safeLocalStorage();
      if (!storage) return;
      try {
        const env: Envelope<T> = { v: value, savedAt: Date.now() };
        storage.setItem(keyFor(owner), JSON.stringify(env));
      } catch {
        // localStorage full or disabled — retry falls back to the
        // pre-checkpoint behaviour (redo on-chain step).
      }
    },
    clear(owner) {
      const storage = safeLocalStorage();
      if (!storage) return;
      try {
        storage.removeItem(keyFor(owner));
      } catch {
        // Best effort.
      }
    },
  };
}

/**
 * Shorthand for slots whose only payload is "did the on-chain step
 * happen?" — the value written is always `true`, and the validator
 * accepts nothing else. Used by mutations where the caller just needs to
 * skip re-invoking (e.g. `join_wallet`, which traps on second call).
 */
export function makeMarkerSlot(
  prefix: string,
  opts?: { ttlMs?: number },
): PendingSlot<true> {
  return makePendingSlot<true>(prefix, (v): v is true => v === true, opts);
}
