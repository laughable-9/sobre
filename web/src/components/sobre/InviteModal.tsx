"use client";

import { useState } from "react";
import { Check, Clock, Copy, Link2, Send } from "lucide-react";

import { INVITE_TTL_MINUTES, useCreateInvite } from "@/hooks/useCreateInvite";
import { backdropClose } from "@/lib/ui";

export function InviteModal({
  walletName,
  contractId,
  onClose,
}: {
  walletName: string;
  contractId: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { createInvite, pending, error } = useCreateInvite(contractId);

  const generate = async () => {
    try {
      const result = await createInvite();
      setUrl(result.url);
      setCopied(false);
    } catch {
      // surfaces via the hook's error state
    }
  };

  const copy = async (current: string) => {
    try {
      await navigator.clipboard.writeText(current);
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
          Generate a one-time link to add a member to {walletName}. The link
          works for one person, expires in {INVITE_TTL_MINUTES} minutes, and
          can&apos;t be reused.
        </p>

        {url ? (
          <>
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
                {url}
              </code>
            </div>
            <div
              className="flex items-center gap-1.5 text-[12px] mb-4"
              style={{ color: "var(--text-2)" }}
            >
              <Clock size={13} strokeWidth={2} />
              Expires in {INVITE_TTL_MINUTES} minutes.
            </div>
          </>
        ) : (
          <p
            className="text-[13px] mb-4"
            style={{ color: "var(--text-3)" }}
          >
            You&apos;ll be asked to confirm with your passkey.
          </p>
        )}

        {error ? (
          <p
            className="text-xs break-all mb-3"
            style={{ color: "var(--sobre-danger)" }}
          >
            {error}
          </p>
        ) : null}

        <div className="sobre-modal-actions">
          <button className="sobre-btn sobre-btn-soft" onClick={onClose}>
            Done
          </button>
          {url ? (
            <button
              className="sobre-btn sobre-btn-primary"
              onClick={() => void copy(url)}
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
          ) : (
            <button
              className="sobre-btn sobre-btn-primary"
              onClick={() => void generate()}
              disabled={pending}
              style={{ opacity: pending ? 0.6 : 1 }}
            >
              <Send size={14} strokeWidth={2} />
              {pending ? "Generating…" : "Generate invite link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
