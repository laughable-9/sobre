"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";

import { CONTRACT_ID } from "@/lib/config";

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
    const joinParam = parsed.searchParams.get("join");
    if (!joinParam) {
      setStatus({
        kind: "invalid",
        reason: "Invite link is missing the ?join= part.",
      });
      return;
    }
    if (joinParam !== CONTRACT_ID) {
      setStatus({
        kind: "invalid",
        reason:
          "This invite is for a different Sobre. Ask the sender to resend the latest link.",
      });
      return;
    }
    setStatus({ kind: "valid", contractId: joinParam });
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
