"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { connect, signup } from "@/lib/passkey";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { findOrCreateWallet } from "@/lib/wallets";

/**
 * Signup smoke test. Not a production screen — the real signup UX lives
 * under /mockup/setup and will fold in this code once the two halves work.
 *
 * What this proves:
 *  - Google OAuth → Supabase session → email/name in browser state
 *  - Passkey signup → smart-wallet contract deployed on testnet
 *
 * Phase 3 of the plan chains them: after Google sign-in, auto-trigger
 * passkey signup if `wallets` row missing, silent reconnect if not.
 */
export default function SignupSmokeTestPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<unknown>(null);
  const [name, setName] = useState("Maria");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) setAuthError(err);
  }, []);

  async function handleGoogle() {
    setAuthError(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setAuthError(error.message);
  }

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setResult(null);
    setStatus("idle");
  }

  async function run<T>(fn: () => Promise<T>) {
    setStatus("working");
    setResult(null);
    try {
      setResult((await fn()) ?? "no cached credential");
      setStatus("done");
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const handleSignup = () => run(() => signup(name));
  const handleReconnect = () => run(connect);

  const handleFindOrCreate = () => {
    if (!session) return;
    const displayName =
      session.user.user_metadata?.full_name ?? session.user.email ?? "Sobre";
    return run(() =>
      findOrCreateWallet(session.user.id, displayName, session.user.email ?? ""),
    );
  };

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 560,
        margin: "0 auto",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#222",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
        Signup — smoke test
      </h1>

      {/* ── Google identity ─────────────────────────────────────────── */}
      <section style={{ marginTop: 20 }}>
        <h2 style={SECTION_HEADING}>1 · Google identity</h2>
        {session ? (
          <div style={SESSION_BOX}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {session.user.user_metadata?.full_name ?? session.user.email}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                {session.user.email}
              </div>
            </div>
            <button onClick={handleSignOut} style={GHOST_BUTTON}>
              Sign out
            </button>
          </div>
        ) : (
          <button onClick={handleGoogle} style={GOOGLE_BUTTON}>
            Continue with Google
          </button>
        )}
        {authError && (
          <p style={{ color: "#c0392b", fontSize: 12, marginTop: 8 }}>
            {authError}
          </p>
        )}
      </section>

      {/* ── Bridge: Google identity → smart wallet ──────────────────── */}
      <section style={{ marginTop: 28 }}>
        <h2 style={SECTION_HEADING}>2 · Find or create wallet</h2>
        <p style={{ color: "#666", fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
          Look up the signed-in user&apos;s wallet row in Supabase. If
          missing, register a passkey, deploy a smart wallet on testnet, and
          insert the link. If present, reconnect silently.
        </p>
        <button
          onClick={handleFindOrCreate}
          disabled={status === "working" || !session}
          style={{
            ...PRIMARY_BUTTON,
            marginTop: 8,
            cursor:
              status === "working" || !session ? "not-allowed" : "pointer",
            opacity: status === "working" || !session ? 0.5 : 1,
          }}
        >
          {!session
            ? "Sign in with Google first"
            : status === "working"
              ? "Working…"
              : "Find or create my wallet"}
        </button>
      </section>

      {/* ── Manual passkey controls (smoke test) ────────────────────── */}
      <section style={{ marginTop: 28 }}>
        <h2 style={SECTION_HEADING}>3 · Manual passkey (smoke test)</h2>
        <p style={{ color: "#666", fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
          Raw passkey controls — bypass the Supabase lookup, useful when
          debugging the wallet SDK alone.
        </p>

        <label style={LABEL}>
          Display name (shown in the passkey prompt)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={INPUT}
          />
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={handleSignup}
            disabled={status === "working"}
            style={{
              ...PRIMARY_BUTTON,
              cursor: status === "working" ? "wait" : "pointer",
              opacity: status === "working" ? 0.7 : 1,
            }}
          >
            {status === "working" ? "Working…" : "Sign up with passkey"}
          </button>
          <button
            onClick={handleReconnect}
            disabled={status === "working"}
            style={GHOST_BUTTON}
          >
            Reconnect
          </button>
        </div>
      </section>

      {/* ── Result panel ────────────────────────────────────────────── */}
      <pre style={RESULT_PANEL}>
        status: {status}
        {"\n"}
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </main>
  );
}

const SECTION_HEADING = {
  fontSize: 13,
  fontWeight: 600,
  color: "#666",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  margin: "0 0 10px",
};

const SESSION_BOX = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  background: "#f6f6f6",
  border: "1px solid #eee",
  borderRadius: 8,
};

const GOOGLE_BUTTON = {
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 600,
  background: "#fff",
  color: "#3c4043",
  border: "1px solid #dadce0",
  borderRadius: 8,
  cursor: "pointer",
  width: "100%",
};

const PRIMARY_BUTTON = {
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  background: "#E8923C",
  color: "#fff",
  border: 0,
  borderRadius: 8,
};

const GHOST_BUTTON = {
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 500,
  background: "#f3f3f3",
  color: "#333",
  border: "1px solid #ddd",
  borderRadius: 8,
  cursor: "pointer",
};

const LABEL = {
  display: "block",
  marginTop: 12,
  fontSize: 13,
  fontWeight: 500,
};

const INPUT = {
  display: "block",
  padding: 10,
  marginTop: 6,
  width: "100%",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
};

const RESULT_PANEL = {
  marginTop: 24,
  padding: 12,
  background: "#f6f6f6",
  border: "1px solid #eee",
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-all" as const,
  minHeight: 80,
};
