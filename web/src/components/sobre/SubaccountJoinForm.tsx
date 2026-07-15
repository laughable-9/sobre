"use client";

import Link from "next/link";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  UserCheckIcon,
  UserCirclePlusIcon,
} from "@phosphor-icons/react";

import { useJoinAsSubaccount } from "@/hooks/useJoinAsSubaccount";
import type { WalletState } from "@/hooks/useWalletState";

interface Props {
  userAddress: string;
  state: WalletState;
  contractId: string;
  /** 32-byte plaintext token from `/invite/<token>?as=subaccount`. */
  inviteToken: Uint8Array;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Sub-account redemption screen. The joiner's display name comes from
 * their Google OAuth session (mirrored server-side on claim), so all this
 * form needs is a confirm tap. Layout matches the dashboard's empty-state
 * card so the invite lands in a real container instead of floating in
 * whitespace.
 */
export function SubaccountJoinForm({
  userAddress,
  state,
  contractId,
  inviteToken,
  onSuccess,
  onCancel,
}: Props) {
  const { joinAsSubaccount, pending, error } = useJoinAsSubaccount(
    userAddress,
    contractId,
  );

  const isFull = state.subaccounts.length >= 4;
  // Members and sub-accounts are disjoint identity sets — the contract
  // would trap on join_as_subaccount for an existing member. Head that
  // off with a friendly explanation instead of the on-chain error.
  const alreadyMember = state.members.some((m) => m.address === userAddress);

  if (alreadyMember) {
    return (
      <InviteCard Icon={UserCheckIcon} title="You're already a member">
        <Link
          href={`/dashboard/${contractId}`}
          className="sobre-btn sobre-btn-primary w-full justify-center"
          style={{ padding: "14px 22px", fontSize: 15 }}
        >
          Open {(state.wallet_name || "this Sobre")}
        </Link>
      </InviteCard>
    );
  }

  return (
    <InviteCard
      Icon={UserCirclePlusIcon}
      title="You're invited"
      body={
        <>
          Join{" "}
          <b style={{ color: "var(--text-1)" }}>{(state.wallet_name || "this Sobre")}</b>{" "}
          as a supplementary account. You&apos;ll see your own spendable
          balance and can cash out anytime.
        </>
      }
    >
      {isFull ? (
        <>
          <div
            className="sobre-warning-bar"
            style={{ textAlign: "left", marginBottom: 14 }}
          >
            <div>
              <b>This Sobre is at its supplementary account limit.</b>{" "}
              Ask the admin to free up a slot before you try again.
            </div>
          </div>
          <Link
            href="/dashboard"
            className="sobre-btn sobre-btn-soft w-full justify-center"
            style={{ padding: "14px 22px", fontSize: 15 }}
          >
            Back to My Sobres
          </Link>
        </>
      ) : (
        <>
          {error ? (
            <p
              className="text-xs break-all mb-3"
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
              onClick={async () => {
                try {
                  await joinAsSubaccount(inviteToken);
                  onSuccess();
                } catch {
                  // surfaced via hook error
                }
              }}
              disabled={pending}
              className="sobre-btn sobre-btn-primary flex-1 justify-center"
              style={{
                padding: "14px 22px",
                fontSize: 15,
                opacity: pending ? 0.5 : 1,
              }}
            >
              {pending ? "Joining…" : "Accept invite"}
            </button>
          </div>
        </>
      )}
    </InviteCard>
  );
}

function InviteCard({
  Icon,
  title,
  body,
  children,
}: {
  Icon: PhosphorIcon;
  title: string;
  body?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex-1 grid place-items-center px-6 py-10">
      <div className="w-full" style={{ maxWidth: 440 }}>
        <div
          className="text-center sobre-card-flat"
          style={{
            padding: "40px 28px",
            background: "var(--sobre-surface)",
          }}
        >
          <div
            className="mx-auto grid place-items-center"
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: "var(--accent-soft)",
              color: "var(--sobre-accent)",
              marginBottom: 20,
            }}
            aria-hidden
          >
            <Icon weight="fill" size={38} />
          </div>
          <h1
            className="font-serif font-semibold"
            style={{
              fontSize: 28,
              letterSpacing: "-0.01em",
              lineHeight: 1.15,
              marginBottom: body ? 10 : 22,
              color: "var(--text-1)",
            }}
          >
            {title}
          </h1>
          {body ? (
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.55,
                color: "var(--text-2)",
                marginBottom: 22,
              }}
            >
              {body}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </main>
  );
}
