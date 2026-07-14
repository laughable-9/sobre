"use client";

import { useState } from "react";
import Link from "next/link";

import { useJoinWallet } from "@/hooks/useJoinWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { Avatar } from "@/components/sobre/Avatar";
import { getProfile } from "@/lib/profile";

export function JoinForm({
  userAddress,
  state,
  contractId,
  inviteToken,
  displayName,
  avatarUrl,
  onSuccess,
  onCancel,
}: {
  userAddress: string;
  state: WalletState;
  contractId: string;
  /** 32-byte plaintext token from the `/invite/<token>` URL. Passed to
   *  `join_wallet` so the contract can verify against the on-chain hash. */
  inviteToken: Uint8Array;
  /** Google display name from the OAuth session — pre-fill for the name
   *  fallback when no local profile is saved yet. */
  displayName?: string;
  /** Google profile picture URL from the OAuth session. */
  avatarUrl?: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const savedProfile = getProfile(userAddress);
  const resolvedName = savedProfile?.name ?? displayName ?? "";
  const { joinWallet, pending, error } = useJoinWallet(userAddress, contractId);

  // `alreadyMember` is handled one altitude up — the /invite/[token] page
  // bounces to the dashboard before this form ever renders.
  const isFull = state.members.length >= 2;

  return (
    <main className="flex-1 grid place-items-center px-6">
      <div className="text-center max-w-md w-full">
        <Avatar
          name={state.wallet_name || "Sobre"}
          size={72}
          style={{ margin: "0 auto" }}
        />
        <h1 className="font-serif text-[36px] font-semibold mt-5 mb-3">
          You&apos;re invited
        </h1>
        <p className="text-[16px] mb-6" style={{ color: "var(--text-2)" }}>
          You&apos;ve been invited to join{" "}
          <b style={{ color: "var(--text-1)" }}>{state.wallet_name}</b>.
        </p>

        {isFull ? (
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
        ) : resolvedName ? (
          <ConfirmJoin
            name={resolvedName}
            avatarUrl={avatarUrl ?? null}
            pending={pending}
            error={error}
            onCancel={onCancel}
            onConfirm={async () => {
              try {
                await joinWallet(resolvedName, inviteToken);
                onSuccess();
              } catch {
                /* error on hook */
              }
            }}
          />
        ) : (
          <ProfileJoin
            avatarUrl={avatarUrl ?? null}
            pending={pending}
            error={error}
            onCancel={onCancel}
            onSubmit={async (name) => {
              try {
                await joinWallet(name, inviteToken);
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

/** One-click confirm: we already have a name (saved profile or Google session)
 *  so we just ask the user to confirm they want to join this wallet. */
function ConfirmJoin({
  name,
  avatarUrl,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  avatarUrl: string | null;
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
        <Avatar name={name} src={avatarUrl} size={44} />
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

/** Fallback: no saved profile and no Google name available. Collect just a
 *  name inline and join. */
function ProfileJoin({
  avatarUrl,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  avatarUrl: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const valid = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    void onSubmit(name.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="text-left space-y-4 mt-4">
      <div
        className="rounded-[10px] p-3 flex items-center gap-3"
        style={{
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
        }}
      >
        <Avatar name={name || "?"} src={avatarUrl} size={40} />
        <p
          className="text-[13px] flex-1"
          style={{ color: "var(--text-2)" }}
        >
          Add a name so you show up on both dashboards.
        </p>
      </div>
      <div className="sobre-input-group">
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          className="sobre-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={32}
          autoFocus
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
          {pending ? "Joining…" : "Join Sobre"}
        </button>
      </div>
    </form>
  );
}
