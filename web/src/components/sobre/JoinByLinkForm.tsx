"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { BackLink } from "@/components/sobre/BackLink";

/** Stellar contract addresses are 56 chars, base32, starting with C. */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

type Status =
  | { kind: "idle" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; contractId: string };

function parseLink(raw: string): Status {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "idle" };
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: "invalid", reason: "That doesn't look like a valid URL." };
  }
  // Accept either /dashboard/<contractId> in the path or ?join=<contractId>
  // in the query. Path wins when both exist (canonical Sobre URL).
  const pathMatch = parsed.pathname.match(/\/dashboard\/(C[A-Z2-7]{55})/);
  const fromPath = pathMatch?.[1];
  const fromQuery = parsed.searchParams.get("join");
  const candidate = fromPath || fromQuery;
  if (!candidate) {
    return {
      kind: "invalid",
      reason:
        "This URL doesn't look like a Sobre invite. It should include the contract address.",
    };
  }
  if (!CONTRACT_ADDRESS_RE.test(candidate)) {
    return {
      kind: "invalid",
      reason: "The contract address in that link doesn't look right.",
    };
  }
  return { kind: "valid", contractId: candidate };
}

export function JoinByLinkForm({
  onValid,
  onBack,
}: {
  /** Called with the parsed contract ID once the invite link checks out. */
  onValid: (contractId: string) => void;
  onBack: () => void;
}) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Avoid double-firing onValid if the parent navigation is async.
  const navigatedRef = useRef(false);

  // Auto-navigate as soon as the input parses to a valid invite link. Reset
  // the latch when the input is cleared so a second valid paste still works.
  useEffect(() => {
    const next = parseLink(link);
    setStatus(next);
    if (next.kind === "valid" && !navigatedRef.current) {
      navigatedRef.current = true;
      onValid(next.contractId);
    }
    if (next.kind === "idle") {
      navigatedRef.current = false;
    }
  }, [link, onValid]);

  return (
    <main className="flex-1 grid place-items-center px-6 py-12">
      <div className="w-full" style={{ maxWidth: 480 }}>
        <BackLink onClick={onBack} className="mb-6" />

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
          Paste the link your family sent you. We&apos;ll take you to the
          invite as soon as it parses.
        </p>

        <div className="sobre-input-group">
          <label htmlFor="invite-link">Invite link</label>
          <input
            id="invite-link"
            className="sobre-input"
            type="url"
            placeholder="https://sobre.app/dashboard?join=…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
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
            <div>Link checks out — taking you to the invite…</div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
