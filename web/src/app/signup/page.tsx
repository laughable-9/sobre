"use client";

import { useState } from "react";

import { connect, signup } from "@/lib/passkey";

/**
 * Passkey signup smoke test. Not a production screen — the real signup UX
 * lives under /mockup/setup and will fold in this code once the smoke test
 * proves the end-to-end loop works.
 *
 * Happy path:
 *   1. Click "Sign up with passkey"
 *   2. Device prompts for FaceID / fingerprint
 *   3. SDK deploys a smart-wallet contract via direct Soroban RPC submission
 *      (friendbot-funded deployer on testnet)
 *   4. UI prints { credentialId, contractId, submitResult }
 *
 * To reconnect on a return visit, click "Reconnect" — the SDK pulls the
 * credential from IndexedDB without a passkey prompt.
 */
export default function SignupSmokeTestPage() {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<unknown>(null);
  const [name, setName] = useState("Maria");

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
        Passkey signup — smoke test
      </h1>
      <p style={{ color: "#666", fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
        Click below to register a passkey and deploy a smart wallet on
        Stellar testnet. The SDK friendbot-funds the deployer; no XLM in the
        browser, no Freighter.
      </p>

      <label
        style={{
          display: "block",
          marginTop: 20,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Display name (shown in the passkey prompt)
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            display: "block",
            padding: 10,
            marginTop: 6,
            width: "100%",
            border: "1px solid #ccc",
            borderRadius: 6,
            fontSize: 14,
          }}
        />
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          onClick={handleSignup}
          disabled={status === "working"}
          style={{
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            background: "#E8923C",
            color: "#fff",
            border: 0,
            borderRadius: 8,
            cursor: status === "working" ? "wait" : "pointer",
            opacity: status === "working" ? 0.7 : 1,
          }}
        >
          {status === "working" ? "Working…" : "Sign up with passkey"}
        </button>
        <button
          onClick={handleReconnect}
          disabled={status === "working"}
          style={{
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 500,
            background: "#f3f3f3",
            color: "#333",
            border: "1px solid #ddd",
            borderRadius: 8,
            cursor: status === "working" ? "wait" : "pointer",
          }}
        >
          Reconnect
        </button>
      </div>

      <pre
        style={{
          marginTop: 24,
          padding: 12,
          background: "#f6f6f6",
          border: "1px solid #eee",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          minHeight: 80,
        }}
      >
        status: {status}
        {"\n"}
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </main>
  );
}
