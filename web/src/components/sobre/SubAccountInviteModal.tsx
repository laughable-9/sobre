"use client";

import { useState } from "react";
import { Check, Clock, Copy, Link2, Send } from "lucide-react";

import { Sheet } from "@/components/sobre/Sheet";
import { INVITE_TTL_MINUTES } from "@/hooks/useCreateInvite";
import { useCreateSubaccountInvite } from "@/hooks/useCreateSubaccountInvite";

interface Props {
  contractId: string;
  familyWalletId: string | null;
  onClose: () => void;
}

/**
 * Generate a share link for a new supplementary account. The joiner signs
 * in with Google, so their name comes from OAuth — no admin-side name
 * picker. One passkey prompt for the on-chain invite mint; Supabase row
 * insert happens in the same call so the URL ships ready to redeem.
 */
export function SubAccountInviteModal({
  contractId,
  familyWalletId,
  onClose,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { createInvite, pending, error } = useCreateSubaccountInvite(
    contractId,
    familyWalletId,
  );

  const generate = async () => {
    try {
      const result = await createInvite();
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
    <Sheet onClose={onClose} ariaLabel="Open a supplementary account">
      <h2>Open a supplementary account</h2>
      <p className="sub">
        For a family member who only needs their own spendable balance.
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
        <p className="text-[13px] mb-4" style={{ color: "var(--text-3)" }}>
          They&apos;ll sign in with Google to redeem. You&apos;ll confirm this
          invite with your passkey.
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
            style={{ opacity: pending ? 0.55 : 1 }}
          >
            <Send size={14} strokeWidth={2} />
            {pending ? "Generating…" : "Generate invite link"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
