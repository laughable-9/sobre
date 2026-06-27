"use client";

import Link from "next/link";

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
 * Sub-account redemption screen. The admin already set the display name +
 * emoji at invite time (carried in the pending family_subaccounts row), so
 * the joiner doesn't pick their own — one tap to confirm, then on-chain
 * join_as_subaccount + server claim.
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
          🎒
        </div>
        <h1 className="font-serif text-[36px] font-semibold mt-5 mb-3">
          You&apos;re invited
        </h1>
        <p className="text-[16px] mb-6" style={{ color: "var(--text-2)" }}>
          You&apos;ve been invited to{" "}
          <b style={{ color: "var(--text-1)" }}>{state.wallet_name}</b> as a
          supplementary account. You&apos;ll see your own spendable balance
          and can cash out anytime.
        </p>

        {isFull ? (
          <>
            <div className="sobre-warning-bar">
              <div>
                <b>This Sobre is at its supplementary account limit.</b> Ask
                the admin to free up a slot before you try again.
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
      </div>
    </main>
  );
}
