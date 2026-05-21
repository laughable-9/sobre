"use client";

import { useState } from "react";
import Link from "next/link";

import { useJoinWallet } from "@/hooks/useJoinWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { EmojiPicker, SOBRE_EMOJIS } from "@/components/sobre/EmojiPicker";
import { getProfile } from "@/lib/profile";

export function JoinForm({
  userAddress,
  state,
  contractId,
  onSuccess,
  onCancel,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const savedProfile = getProfile(userAddress);
  const { joinWallet, pending, error } = useJoinWallet(userAddress, contractId);

  const alreadyMember = state.members.some(
    (m) => m.address === userAddress,
  );
  const isFull = state.members.length >= 2;

  return (
    <main className="flex-1 grid place-items-center px-6">
      <div className="text-center max-w-md w-full">
        <div
          className="grid place-items-center mx-auto text-[40px]"
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
          }}
        >
          📩
        </div>
        <h1 className="font-serif text-[36px] font-semibold mt-5 mb-3">
          You&apos;re invited
        </h1>
        <p className="text-[16px] mb-6" style={{ color: "var(--text-2)" }}>
          You&apos;ve been invited to join{" "}
          <b style={{ color: "var(--text-1)" }}>{state.wallet_name}</b>.
        </p>

        {alreadyMember ? (
          <>
            <div
              className="sobre-warning-bar"
              style={{
                background: "var(--accent-soft)",
                borderColor: "#cfe0d4",
                color: "var(--sobre-accent)",
              }}
            >
              <div>You&apos;re already a member of this wallet.</div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="sobre-btn sobre-btn-primary w-full justify-center mt-4"
              style={{ padding: "14px 22px", fontSize: 15 }}
            >
              Go to the dashboard
            </button>
          </>
        ) : isFull ? (
          <>
            <div className="sobre-warning-bar">
              <div>
                <b>This family is already full.</b> Sobre caps each wallet at
                2 members and{" "}
                <b>{state.wallet_name}</b> already has two. Ask the admin to
                remove someone before you try again.
              </div>
            </div>
            <Link
              href="/dashboard"
              className="sobre-btn sobre-btn-soft w-full justify-center mt-4"
              style={{ padding: "14px 22px", fontSize: 15 }}
            >
              Back to My Sobres
            </Link>
          </>
        ) : savedProfile ? (
          <ConfirmJoin
            name={savedProfile.name}
            emoji={savedProfile.emoji}
            pending={pending}
            error={error}
            onCancel={onCancel}
            onConfirm={async () => {
              try {
                await joinWallet(savedProfile.name, savedProfile.emoji);
                onSuccess();
              } catch {
                /* error on hook */
              }
            }}
          />
        ) : (
          <ProfileJoin
            contractId={contractId}
            pending={pending}
            error={error}
            onCancel={onCancel}
            onSubmit={async (name, emoji) => {
              try {
                await joinWallet(name, emoji);
                onSuccess();
              } catch {
                /* error on hook */
              }
            }}
          />
        )}
      </div>
    </main>
  );
}

/** One-click confirm: the user already has a saved profile so we don't ask
 *  for a name + emoji again — just confirm they want to join this wallet
 *  under their existing identity. */
function ConfirmJoin({
  name,
  emoji,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  emoji: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4 mt-4">
      <div
        className="rounded-[10px] p-3 flex items-center gap-3"
        style={{
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="grid place-items-center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            fontSize: 24,
          }}
        >
          {emoji}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-3)", fontWeight: 600 }}
          >
            Joining as
          </div>
          <div
            className="text-[15px] font-medium truncate"
            style={{ color: "var(--text-1)" }}
          >
            {name}
          </div>
        </div>
      </div>
      {error ? (
        <p
          className="text-xs break-all"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="sobre-btn sobre-btn-soft flex-1 justify-center"
          style={{ padding: "14px 22px", fontSize: 15 }}
          disabled={pending}
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="sobre-btn sobre-btn-primary flex-1 justify-center"
          style={{
            padding: "14px 22px",
            fontSize: 15,
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? "Joining…" : "Confirm and join"}
        </button>
      </div>
    </div>
  );
}

/** Fallback: no saved profile (user hit the invite link before doing the
 *  first-connect profile setup). Collect name + emoji inline and join. */
function ProfileJoin({
  contractId: _contractId,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  contractId: string;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string, emoji: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(SOBRE_EMOJIS[1]);
  const valid = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    void onSubmit(name.trim(), emoji);
  };

  return (
    <form onSubmit={handleSubmit} className="text-left space-y-4 mt-4">
      <p
        className="text-[14px] -mt-2"
        style={{ color: "var(--text-3)" }}
      >
        Pick your name + emoji so you show up on both dashboards.
      </p>
      <div className="sobre-input-group">
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          className="sobre-input"
          type="text"
          placeholder="Maria"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={32}
          autoFocus
        />
      </div>
      <div className="sobre-input-group">
        <label>Your icon</label>
        <EmojiPicker value={emoji} onChange={setEmoji} disabled={pending} />
      </div>
      {error ? (
        <p
          className="text-xs break-all"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="sobre-btn sobre-btn-soft flex-1 justify-center"
          style={{ padding: "14px 22px", fontSize: 15 }}
          disabled={pending}
        >
          Not now
        </button>
        <button
          type="submit"
          disabled={!valid || pending}
          className="sobre-btn sobre-btn-primary flex-1 justify-center"
          style={{
            padding: "14px 22px",
            fontSize: 15,
            opacity: !valid || pending ? 0.5 : 1,
          }}
        >
          {pending ? "Joining…" : "Join wallet"}
        </button>
      </div>
    </form>
  );
}
