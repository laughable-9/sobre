"use client";

import { useState } from "react";
import { Check, Clock, Copy, Link2, Send } from "lucide-react";

import { INVITE_TTL_MINUTES } from "@/hooks/useCreateInvite";
import { useCreateSubaccountInvite } from "@/hooks/useCreateSubaccountInvite";
import { backdropClose } from "@/lib/ui";

import { EmojiPicker, SOBRE_EMOJIS } from "./EmojiPicker";

interface Props {
  walletName: string;
  contractId: string;
  familyWalletId: string | null;
  onClose: () => void;
}

/**
 * Two-step modal: admin sets the sub-account's display name + emoji, then
 * generates the share link. The on-chain `create_subaccount_invite` and the
 * Supabase row insert both happen on "Generate", so the URL ships with the
 * display data already in place.
 */
export function SubAccountInviteModal({
  walletName,
  contractId,
  familyWalletId,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(SOBRE_EMOJIS[0]);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { createInvite, pending, error } = useCreateSubaccountInvite(
    contractId,
    familyWalletId,
  );

  const trimmed = name.trim();
  const canGenerate = trimmed.length > 0 && !pending;

  const generate = async () => {
    try {
      const result = await createInvite(trimmed, emoji);
      setUrl(result.url);
      setCopied(false);
    } catch {
      // surfaced via hook error
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
      <div
        className="sobre-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <h2>Open a supplementary account</h2>
        <p className="sub">
          For a family member who only needs their own spendable balance.
          They get a stripped view of {walletName}. Just their balance and
          Cash out.
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
          <>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-3)",
                marginBottom: 6,
              }}
            >
              Their name
            </div>
            <div className="sobre-input-wrap" style={{ marginBottom: 14 }}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Junior"
                className="sobre-input"
                maxLength={32}
                style={{ fontSize: 16 }}
              />
            </div>

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-3)",
                marginBottom: 6,
              }}
            >
              Avatar
            </div>
            <div style={{ marginBottom: 18 }}>
              <EmojiPicker value={emoji} onChange={setEmoji} />
            </div>

            <p className="text-[13px] mb-4" style={{ color: "var(--text-3)" }}>
              You&apos;ll be asked to confirm with your passkey.
            </p>
          </>
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
              disabled={!canGenerate}
              style={{ opacity: canGenerate ? 1 : 0.55 }}
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
