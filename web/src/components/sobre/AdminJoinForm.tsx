"use client";

import { useState } from "react";
import { CrownIcon, WarningIcon } from "@phosphor-icons/react";

import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { useJoinWallet } from "@/hooks/useJoinWallet";
import {
  useRedeemAdminInvite,
  type RedeemAdminOutcome,
} from "@/hooks/useRedeemAdminInvite";
import { Avatar } from "@/components/sobre/Avatar";

/**
 * Admin-role invite landing card. No name / emoji / avatar picker —
 * identity comes from the signed-in Google session, the flow is a single
 * "Join <family name> as admin" button so the invitee sees which Sobre
 * they're joining before anything happens. Runs the chain-side join_wallet
 * (skipped when the caller is already a chain member — a "promote member
 * to admin" invite is one path this landing supports) then the redeem RPC.
 */
export function AdminJoinForm({
  wallet,
  state,
  contractId,
  inviteToken,
  alreadyMember,
  refreshWalletState,
  onSuccess,
}: {
  wallet: WalletConnectionState;
  state: WalletState;
  contractId: string;
  inviteToken: Uint8Array;
  /** True when the caller is already in state.members — skip the on-chain
   *  join_wallet call entirely and go straight to the RPC. */
  alreadyMember: boolean;
  /** useWalletState.refresh — invoked between the chain join and the RPC
   *  so the redeem call sees the just-joined family_members row without
   *  waiting on the 3s poll cycle. */
  refreshWalletState: () => Promise<void> | void;
  onSuccess: () => void;
}) {
  const address = wallet.address;
  if (!address) throw new Error("AdminJoinForm requires a signed-in wallet.");
  const displayName = wallet.user?.name ?? "";
  const avatarUrl = wallet.wallet?.avatar_url ?? null;

  const { joinWallet, pending: joining } = useJoinWallet(address, contractId);
  const { redeem, pending: redeeming } = useRedeemAdminInvite();
  const [error, setError] = useState<string | null>(null);
  const busy = joining || redeeming;

  const handleJoin = async () => {
    setError(null);
    try {
      if (!alreadyMember) {
        await joinWallet(displayName, "", inviteToken);
        // Wait for the wallet-state poll to catch the new chain member row
        // before the RPC checks membership. Refresh triggers it now
        // instead of waiting up to 3s.
        await refreshWalletState();
      }
      const result = await redeem(inviteToken);
      const errMsg = errorFor(result);
      if (errMsg === null) onSuccess();
      else setError(errMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="flex-1 grid place-items-center px-6">
      <div className="text-center max-w-md w-full">
        <div
          className="grid place-items-center mx-auto"
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
            color: "var(--sobre-primary)",
          }}
        >
          <CrownIcon size={28} weight="fill" />
        </div>
        <h1 className="font-serif text-[32px] font-semibold mt-5 mb-3">
          You&apos;re invited as an admin
        </h1>
        <p className="text-[15px] mb-6" style={{ color: "var(--text-2)" }}>
          Join{" "}
          <b style={{ color: "var(--text-1)" }}>
            {state.wallet_name || "this Sobre"}
          </b>
          {" "}with full admin powers — equal control over splits, spends,
          and household settings.
        </p>

        <div
          className="rounded-[10px] p-3 mb-4 flex items-center gap-3 text-left"
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <Avatar src={avatarUrl} name={displayName || address} size={40} />
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] uppercase tracking-wider"
              style={{ color: "var(--text-3)", fontWeight: 600 }}
            >
              Joining as
            </div>
            <div
              className="truncate text-[14px] font-semibold"
              style={{ color: "var(--text-1)" }}
            >
              {displayName || address}
            </div>
          </div>
        </div>

        {error ? (
          <div className="sobre-warning-bar mb-4">
            <WarningIcon size={16} weight="fill" />
            <div>{error}</div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleJoin()}
          disabled={busy}
          className="sobre-btn sobre-btn-primary w-full justify-center"
          style={{
            padding: "14px 22px",
            fontSize: 15,
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {joining
            ? "Joining…"
            : redeeming
              ? "Granting admin role…"
              : `Join ${state.wallet_name || "Sobre"} as admin`}
        </button>
      </div>
    </main>
  );
}

/** Outcome → user-facing copy. Returning `null` means success (no error to
 *  surface). Exhaustiveness is enforced at the switch's default branch. */
function errorFor(r: RedeemAdminOutcome): string | null {
  switch (r.outcome) {
    case "admin_granted":
      return null;
    case "family_full":
      return `This Sobre already has ${r.current_admins} of ${r.admin_cap} admins.`;
    case "not_a_chain_member":
      return "Chain hasn't caught up yet — refresh in a moment.";
    case "already_redeemed":
      return "This invite has already been used.";
    case "invalid_invite":
      return "This isn't an admin invite. Ask for a fresh link.";
    case "not_authenticated":
      return "You're not signed in. Refresh and sign in again.";
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaustive: never = r;
      return "Something went wrong. Try again.";
    }
  }
}
