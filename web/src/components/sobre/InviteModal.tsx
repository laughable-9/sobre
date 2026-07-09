"use client";

import { useState } from "react";
import { Check, Clock, Copy, Link2, Send } from "lucide-react";

import { INVITE_TTL_MINUTES, useCreateInvite } from "@/hooks/useCreateInvite";
import { backdropClose } from "@/lib/ui";

/** A member the admin intended to invite (collected during onboarding). Role
 *  is a cosmetic label — the contract only knows a single admin + flat
 *  members, so this doesn't grant on-chain powers. */
export interface InviteSuggestion {
  name: string;
  email: string;
  role: string;
}

export function InviteModal({
  walletName,
  contractId,
  familyWalletId,
  createdByWalletId,
  suggestions = [],
  onClose,
}: {
  walletName: string;
  contractId: string;
  /** family_wallets.id — required so admin-role invites can persist their
   *  Supabase hint row. Non-admin (generic member) invites don't touch
   *  Supabase, so null is tolerated but disables admin-row minting. */
  familyWalletId: string | null;
  /** wallets.id of the current admin. Threaded through from the parent's
   *  usePasskeyWallet so the admin-invite path doesn't do a redundant
   *  wallets round-trip. Null disables admin-row minting. */
  createdByWalletId: string | null;
  /** Optional pre-filled members from onboarding. Each gets its own on-demand
   *  link so the admin mints one invite (one passkey prompt) at a time. */
  suggestions?: InviteSuggestion[];
  onClose: () => void;
}) {
  // Links generated for named suggestions, keyed by row index.
  const [links, setLinks] = useState<Record<number, string>>({});
  // A single "generic" link (no specific member), for the manual path.
  const [genericUrl, setGenericUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const { createInvite, pending, error } = useCreateInvite(contractId);

  const copy = async (value: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(tag);
      setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch {
      // clipboard refused; ignore
    }
  };

  const generateFor = async (idx: number) => {
    setActiveIdx(idx);
    try {
      const suggestion = suggestions[idx];
      const canMintAdmin =
        suggestion?.role === "admin" && familyWalletId && createdByWalletId;
      const result = await createInvite(
        canMintAdmin
          ? {
              intendedRole: "admin",
              familyWalletId,
              createdByWalletId,
            }
          : undefined,
      );
      setLinks((prev) => ({ ...prev, [idx]: result.url }));
    } catch {
      // surfaces via the hook's error state
    } finally {
      setActiveIdx(null);
    }
  };

  // Generic invites (no named suggestion) can't infer intent — always
  // mint them as member. Admins who want to hand-invite another admin
  // should use a named suggestion so we know to mark the hint.
  const generateGeneric = async () => {
    setActiveIdx(-1);
    try {
      const result = await createInvite();
      setGenericUrl(result.url);
    } catch {
      // surfaces via the hook's error state
    } finally {
      setActiveIdx(null);
    }
  };

  const hasSuggestions = suggestions.length > 0;

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite {hasSuggestions ? "your members" : "a family member"}</h2>
        <p className="sub">
          {hasSuggestions
            ? `Generate a one-time link for each person you added to ${walletName}. Each link works for one person and expires in ${INVITE_TTL_MINUTES} minutes.`
            : `Generate a one-time link to add a member to ${walletName}. The link works for one person, expires in ${INVITE_TTL_MINUTES} minutes, and can't be reused.`}
        </p>

        {hasSuggestions ? (
          <div className="mb-4 space-y-2">
            {suggestions.map((s, i) => {
              const url = links[i];
              const isBusy = pending && activeIdx === i;
              return (
                <div
                  key={`${s.name}-${i}`}
                  className="rounded-[10px] p-3"
                  style={{
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[14px] font-semibold"
                        style={{ color: "var(--text-1)" }}
                      >
                        {s.name}
                      </div>
                      <div
                        className="truncate text-[12px]"
                        style={{ color: "var(--text-2)" }}
                      >
                        {roleLabel(s.role)}
                        {s.email ? ` · ${s.email}` : ""}
                      </div>
                    </div>
                    {url ? (
                      <button
                        type="button"
                        className="sobre-btn sobre-btn-soft"
                        style={{ padding: "7px 12px", fontSize: 13 }}
                        onClick={() => void copy(url, `s-${i}`)}
                      >
                        {copied === `s-${i}` ? (
                          <>
                            <Check size={13} strokeWidth={2.5} />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy size={13} strokeWidth={2} />
                            Copy
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="sobre-btn sobre-btn-primary"
                        style={{
                          padding: "7px 12px",
                          fontSize: 13,
                          opacity: pending ? 0.6 : 1,
                        }}
                        disabled={pending}
                        onClick={() => void generateFor(i)}
                      >
                        <Send size={13} strokeWidth={2} />
                        {isBusy ? "Creating…" : "Get link"}
                      </button>
                    )}
                  </div>
                  {url ? (
                    <code
                      className="mt-2 block break-all text-[11px]"
                      style={{ color: "var(--text-2)" }}
                    >
                      {url}
                    </code>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Manual / generic link path — always available. */}
        {genericUrl ? (
          <>
            <div
              className="mb-3 flex items-center gap-3 rounded-[10px] p-3"
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
                className="flex-1 break-all text-[12px]"
                style={{ color: "var(--text-1)" }}
              >
                {genericUrl}
              </code>
            </div>
            <div
              className="mb-4 flex items-center gap-1.5 text-[12px]"
              style={{ color: "var(--text-2)" }}
            >
              <Clock size={13} strokeWidth={2} />
              Expires in {INVITE_TTL_MINUTES} minutes.
            </div>
          </>
        ) : !hasSuggestions ? (
          <p className="mb-4 text-[13px]" style={{ color: "var(--text-3)" }}>
            You&apos;ll be asked to confirm with your passkey.
          </p>
        ) : null}

        {error ? (
          <p
            className="mb-3 break-all text-xs"
            style={{ color: "var(--sobre-danger)" }}
          >
            {error}
          </p>
        ) : null}

        <div className="sobre-modal-actions">
          <button className="sobre-btn sobre-btn-soft" onClick={onClose}>
            Done
          </button>
          {genericUrl ? (
            <button
              className="sobre-btn sobre-btn-primary"
              onClick={() => void copy(genericUrl, "generic")}
            >
              {copied === "generic" ? (
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
              onClick={() => void generateGeneric()}
              disabled={pending}
              style={{ opacity: pending ? 0.6 : 1 }}
            >
              <Send size={14} strokeWidth={2} />
              {pending && activeIdx === -1
                ? "Generating…"
                : hasSuggestions
                  ? "Generic link"
                  : "Generate invite link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  return role === "admin" ? "Admin" : "Recipient";
}
