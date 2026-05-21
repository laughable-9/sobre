"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";

/** Stellar contract addresses are 56 chars, base32, starting with C. */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

export function JoinByLinkForm({
  onValid,
  onBack,
}: {
  /** Called with the parsed contract ID once the invite link checks out. */
  onValid: (contractId: string) => void;
  onBack: () => void;
}) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "invalid"; reason: string }
    | { kind: "valid"; contractId: string }
  >({ kind: "idle" });

  const validate = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatus({ kind: "invalid", reason: "Paste your invite link first." });
      return;
    }
    let parsed: URL | null = null;
    try {
      parsed = new URL(trimmed);
    } catch {
      setStatus({
        kind: "invalid",
        reason: "That doesn't look like a valid URL.",
      });
      return;
    }
    // Accept either /dashboard/<contractId> in the path or ?join=<contractId>
    // in the query — both shapes are valid invite links. Path wins when both
    // exist (it's the canonical Sobre URL).
    const pathMatch = parsed.pathname.match(/\/dashboard\/(C[A-Z2-7]{55})/);
    const fromPath = pathMatch?.[1];
    const fromQuery = parsed.searchParams.get("join");
    const candidate = fromPath || fromQuery;
    if (!candidate) {
      setStatus({
        kind: "invalid",
        reason:
          "This URL doesn't look like a Sobre invite. It should include the contract address.",
      });
      return;
    }
    if (!CONTRACT_ADDRESS_RE.test(candidate)) {
      setStatus({
        kind: "invalid",
        reason: "The contract address in that link doesn't look right.",
      });
      return;
    }
    setStatus({ kind: "valid", contractId: candidate });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind === "valid") {
      onValid(status.contractId);
      return;
    }
    validate(link);
  };

  return (
    <main className="flex-1 grid place-items-center px-6 py-12">
      <div className="w-full" style={{ maxWidth: 480 }}>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] mb-6"
          style={{ color: "var(--text-2)" }}
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <h1
          className="font-serif"
          style={{ fontSize: 32, fontWeight: 600, marginBottom: 8 }}
        >
          Got an invite?
        </h1>
        <p
          className="text-[15px] mb-6"
          style={{ color: "var(--text-2)" }}
        >
          Paste the link your family sent you. We&apos;ll check it&apos;s a
          real Sobre invite before you connect anything.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="sobre-input-group">
            <label htmlFor="invite-link">Invite link</label>
            <input
              id="invite-link"
              className="sobre-input"
              type="url"
              placeholder="https://sobre.app/dashboard?join=…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                if (status.kind !== "idle") setStatus({ kind: "idle" });
              }}
              autoFocus
            />
          </div>

          {status.kind === "invalid" ? (
            <div className="sobre-warning-bar">
              <AlertTriangle size={16} strokeWidth={2.2} />
              <div>{status.reason}</div>
            </div>
          ) : null}

          {status.kind === "valid" ? (
            <div
              className="sobre-warning-bar"
              style={{
                background: "var(--accent-soft)",
                borderColor: "#cfe0d4",
                color: "var(--sobre-accent)",
              }}
            >
              <Check size={16} strokeWidth={2.5} />
              <div>
                <b>Looks legit.</b> Continue to accept the invite and pick
                your name + emoji.
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            className="sobre-btn sobre-btn-primary w-full justify-center"
            style={{ padding: "14px 22px", fontSize: 15 }}
          >
            {status.kind === "valid" ? "Continue" : "Check link"}
          </button>
        </form>
      </div>
    </main>
  );
}
