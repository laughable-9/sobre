"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

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

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin
    ? `${origin}/dashboard/${contractId}?join=${contractId}`
    : `/dashboard/${contractId}?join=${contractId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard refused; ignore
    }
  };

  return (
    <div className="sobre-modal-bg" onClick={onClose}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite a family member</h2>
        <p className="sub">
          Share this link with the person you want to add to {walletName}. They
          open it, connect their Freighter, pick a name + emoji, and they&apos;re
          in. The wallet caps at 2 members.
        </p>

        <div
          className="rounded-[10px] p-3 flex items-center gap-3 mb-4"
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
            {url}
          </code>
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
