"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Copy, Link2, RefreshCcw } from "lucide-react";

import { backdropClose } from "@/lib/ui";

export const INVITE_EXPIRY_MINUTES = 30;

function buildInviteUrl(origin: string, contractId: string, expiresAt: number) {
  const base = origin || "";
  return `${base}/dashboard/${contractId}?join=${contractId}&expires=${expiresAt}`;
}

export function InviteModal({
  walletName,
  contractId,
  onClose,
}: {
  walletName: string;
  contractId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  // Lock the expires-at at modal mount so the URL the user copies is the same
  // one shown on screen. Reopen the modal to regenerate.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    setExpiresAt(
      Math.floor(Date.now() / 1000) + INVITE_EXPIRY_MINUTES * 60,
    );
  }, []);

  const url = expiresAt ? buildInviteUrl(origin, contractId, expiresAt) : "";
  const expiresAtClock = expiresAt
    ? new Date(expiresAt * 1000).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard refused; ignore
    }
  };

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite a family member</h2>
        <p className="sub">
          Share this link with the person you want to add to {walletName}.
          One-time use — once they join, the link stops working for anyone else.
        </p>

        <div
          className="rounded-[10px] p-3 flex items-center gap-3 mb-3"
          style={{
            background: "var(--surface-alt)",
            border: "1.5px dashed var(--border-strong)",
          }}
        >
          <Link2
            size={18}
            strokeWidth={2}
            style={{ color: "var(--sobre-accent)", flexShrink: 0 }}
          />
          <code
            className="text-[12px] break-all flex-1"
            style={{ color: "var(--text-1)" }}
          >
            {url || "Generating…"}
          </code>
        </div>

        <div
          className="flex items-center justify-between gap-2 text-[12px] mb-4"
          style={{ color: "var(--text-2)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} strokeWidth={2} />
            Expires in {INVITE_EXPIRY_MINUTES} minutes
            {expiresAtClock ? ` (at ${expiresAtClock})` : ""}.
          </span>
          <button
            type="button"
            onClick={() => {
              setExpiresAt(
                Math.floor(Date.now() / 1000) + INVITE_EXPIRY_MINUTES * 60,
              );
              setCopied(false);
            }}
            className="inline-flex items-center gap-1 text-[12px] font-medium"
            style={{ color: "var(--sobre-accent)" }}
            title="Invalidate the current link and mint a fresh one"
          >
            <RefreshCcw size={12} strokeWidth={2.2} />
            Generate new link
          </button>
        </div>

        <div className="sobre-modal-actions">
          <button
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
          >
            Done
          </button>
          <button
            className="sobre-btn sobre-btn-primary"
            onClick={() => void copy()}
            disabled={!url}
          >
            {copied ? (
              <>
                <Check size={14} strokeWidth={2.5} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={14} strokeWidth={2} />
                Copy link
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
