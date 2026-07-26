"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { disconnect as disconnectPasskey } from "@/lib/passkey";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  displayNameFromSession,
  findOrCreateWallet,
  type WalletRow,
} from "@/lib/wallets";

export type WalletStatus =
  | "checking"
  | "signed-out"
  | "creating"
  | "connected"
  | "error";

export interface WalletConnectionState {
  status: WalletStatus;
  /** Smart-wallet C-address once the user is signed in and the wallet row is
   *  resolved. null while we're still hydrating the Supabase session, while
   *  passkey signup is in flight, or after sign-out. */
  address: string | null;
  /** The full Supabase-side wallet row, useful for callers that need
   *  fields beyond the contract address (display name, avatar, DB id). */
  wallet: WalletRow | null;
  /** The signed-in Supabase user's display name + email. Cheap to read off
   *  the session, so we expose it for consumers that would otherwise wire a
   *  second subscription. */
  user: { name: string; email: string } | null;
  error: string | null;
  /** Kick off Google OAuth. Bounces to /auth/callback and back; the
   *  session-change listener picks it up. */
  connect: (opts?: { redirectTo?: string }) => Promise<void>;
  /** Sign out of Supabase + drop the passkey-kit instance. */
  disconnect: () => Promise<void>;
  /** Force a re-pull of the wallet row (e.g. after a profile edit elsewhere). */
  refresh: () => Promise<void>;
}

/**
 * Source of truth for the user's passkey-backed smart wallet, replacing
 * useFreighter. Behavior:
 *
 *   1. On mount, hydrate the Supabase session and subscribe to changes.
 *   2. When a session lands and no wallet row is cached, call
 *      findOrCreateWallet — silent reconnect for returning users, passkey
 *      signup + smart-wallet deploy for first-timers.
 *   3. Expose the smart-wallet C-address as `address` so consumers
 *      (useWalletState, contract hooks, dashboards) get the same shape they
 *      used with Freighter — the C-address is what the Sobre contract
 *      stores in its member list, so equality checks like
 *      `state.admin === address` just work.
 */
export function usePasskeyWallet(): WalletConnectionState {
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guard against double-bootstrap when both the initial getSession and the
  // onAuthStateChange callback fire with the same session.
  const bootstrappingRef = useRef(false);
  // Remember which Supabase user we've already tried to bootstrap for.
  // Supabase auto-refreshes tokens (~every 55min, and on visibility change)
  // which produces a new session OBJECT for the same user. Without this
  // guard the bootstrap effect re-fires on every refresh; if the previous
  // attempt failed (user cancelled FaceID, network blip, etc), it re-runs
  // findOrCreateWallet which re-prompts WebAuthn — the passkey-spam bug
  // Kyle hit on the dashboard. Only reset on sign-out or explicit retry().
  const lastAttemptedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (!data.session) setStatus("signed-out");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (!s) {
        setWallet(null);
        setStatus("signed-out");
        bootstrappingRef.current = false;
        lastAttemptedUserIdRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    if (wallet || bootstrappingRef.current) return;
    // If we've already attempted bootstrap for this user (whether it
    // succeeded or errored), don't re-fire on a token refresh. The user
    // can drive an explicit retry via the retry() method.
    if (lastAttemptedUserIdRef.current === session.user.id) return;
    lastAttemptedUserIdRef.current = session.user.id;
    bootstrappingRef.current = true;
    setStatus("creating");
    setError(null);
    let settled = false;
    // Race the wallet bootstrap against a hard timeout. A hung network
    // used to pin status='creating' forever, and the "Loading…" screen
    // in the signed-in branch had no retry affordance.
    const timeoutMs = 20_000;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setError(
        "Sign-in is taking longer than expected. Check your connection and try again.",
      );
      setStatus("error");
      bootstrappingRef.current = false;
    }, timeoutMs);
    findOrCreateWallet(session)
      .then(({ wallet: row }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        setWallet(row);
        setStatus("connected");
      })
      .catch((e: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        bootstrappingRef.current = false;
      });
  }, [session, wallet]);

  const connect = useCallback(async (opts?: { redirectTo?: string }) => {
    // User-driven retry: clear the last-attempted guard so if they end
    // up back on the same Supabase user (typical for "click Continue
    // with Google after an error"), the bootstrap effect will re-fire.
    lastAttemptedUserIdRef.current = null;
    setError(null);
    const supabase = getSupabaseBrowserClient();
    // Carry the current page through OAuth so the callback bounces back
    // here instead of defaulting to /signup. Caller can override by passing
    // a fully-formed redirectTo.
    const nextHere =
      window.location.pathname + window.location.search + window.location.hash;
    const redirectTo =
      opts?.redirectTo ??
      `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextHere)}`;
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthErr) {
      setError(oauthErr.message);
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    disconnectPasskey();
    setSession(null);
    setWallet(null);
    setError(null);
    setStatus("signed-out");
    bootstrappingRef.current = false;
    lastAttemptedUserIdRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const { wallet: row } = await findOrCreateWallet(session);
      setWallet(row);
      setStatus("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [session]);

  const user = session
    ? {
        name: displayNameFromSession(session),
        email: session.user.email ?? "",
      }
    : null;

  return {
    status,
    address: wallet?.contract_id ?? null,
    wallet,
    user,
    error,
    connect,
    disconnect,
    refresh,
  };
}
