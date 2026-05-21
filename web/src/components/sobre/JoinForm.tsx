"use client";

import { useState } from "react";

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
  // Pre-fill from the user's saved profile so accepting an invite is a single
  // click once they've set up their default name + emoji.
  const savedProfile = getProfile(userAddress);
  const [name, setName] = useState(savedProfile?.name ?? "");
  const [emoji, setEmoji] = useState<string>(
    savedProfile?.emoji ?? SOBRE_EMOJIS[1],
  );
  const { joinWallet, pending, error } = useJoinWallet(userAddress, contractId);

  const alreadyMember = state.members.some(
    (m) => m.address === userAddress,
  );
  const isFull = state.members.length >= 2;
  const valid = name.trim().length > 0 && !alreadyMember && !isFull;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await joinWallet(name.trim(), emoji);
      onSuccess();
    } catch {
      // error on hook
    }
  };

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
          <b style={{ color: "var(--text-1)" }}>{state.wallet_name}</b>. Pick
          your name + emoji and you&apos;ll show up on both dashboards.
        </p>

        {alreadyMember ? (
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
        ) : isFull ? (
          <div className="sobre-warning-bar">
            <div>
              <b>This wallet is full.</b> Sobre caps each wallet at 2 members.
              Ask the admin to remove someone first.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="text-left space-y-4 mt-4">
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
              <EmojiPicker
                value={emoji}
                onChange={setEmoji}
                disabled={pending}
              />
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
        )}
      </div>
    </main>
  );
}
