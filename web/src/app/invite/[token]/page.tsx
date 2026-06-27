"use client";

import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { JoinForm } from "@/components/sobre/JoinForm";
import { SignInPanel } from "@/components/sobre/SignInPanel";
import { SubaccountJoinForm } from "@/components/sobre/SubaccountJoinForm";
import { TopBar } from "@/components/sobre/TopBar";
import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { useWalletState } from "@/hooks/useWalletState";
import { decodeInviteToken } from "@/lib/encoding";

interface RouteParams {
  token: string;
}

export default function InviteLandingPage(props: {
  params: Promise<RouteParams>;
}) {
  const { token } = use(props.params);
  return (
    <Suspense fallback={<Loading />}>
      <Landing token={token} />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="sobre-app">
      <main className="flex-1 grid place-items-center px-6">
        <p style={{ color: "var(--text-2)" }}>Loading…</p>
      </main>
    </div>
  );
}

function Landing({ token }: { token: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contractId = searchParams.get("wallet");
  const isSubaccountInvite = searchParams.get("as") === "subaccount";
  const wallet = usePasskeyWallet();
  const { address } = wallet;
  const walletState = useWalletState(address, contractId);
  const state = walletState.state;

  // Plain `let` — `token` is a route param that doesn't change without
  // remount, decode is sub-millisecond. No memoization warranted.
  const inviteToken = decodeInviteToken(token);

  const [redeeming, setRedeeming] = useState(false);

  // Auto-bounce when the connected user already belongs to this wallet in
  // the role this link is for. Sub-account invites only short-circuit on
  // sub-account membership; a member shouldn't be bounced away from a fresh
  // sub-account invite they could still redeem.
  const alreadyMember =
    state !== null &&
    address !== null &&
    state.members.some((m) => m.address === address);
  const alreadySubaccount =
    state !== null &&
    address !== null &&
    state.subaccounts.some((s) => s.address === address);
  const alreadyJoined = isSubaccountInvite ? alreadySubaccount : alreadyMember;
  useEffect(() => {
    if (alreadyJoined && !redeeming && contractId) {
      router.replace(`/dashboard/${contractId}`);
    }
  }, [alreadyJoined, redeeming, contractId, router]);

  // ─── Bad link ─────────────────────────────────────────────────────────
  if (!contractId || !inviteToken) {
    return (
      <div className="sobre-app">
        <main className="flex-1 grid place-items-center px-6">
          <div className="text-center max-w-md">
            <h1 className="font-serif text-[28px] font-semibold mt-5 mb-3">
              This invite link is broken
            </h1>
            <p
              className="text-[14px] mb-5"
              style={{ color: "var(--text-2)" }}
            >
              The URL is missing the wallet or token. Ask the admin to send a
              fresh invite.
            </p>
            <Link
              href="/dashboard"
              className="sobre-btn sobre-btn-soft"
              style={{ padding: "10px 16px", fontSize: 13 }}
            >
              <ChevronLeft size={14} />
              My Sobres
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // ─── Not signed in / wallet bootstrapping ─────────────────────────────
  if (!address) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <main className="flex-1 grid place-items-center px-6">
          <SignInPanel
            wallet={wallet}
            title="You're invited to a Sobre"
            subtitle="Sign in to accept the invite and join the wallet."
          />
        </main>
      </div>
    );
  }

  // ─── Loading wallet state / already joined (redirecting) ──────────────
  if (!state || (alreadyJoined && !redeeming)) {
    return (
      <div className="sobre-app">
        <TopBar
          wallet={wallet}
          walletState={state ?? undefined}
          contractId={contractId}
        />
        <main className="flex-1 grid place-items-center px-6">
          <p style={{ color: "var(--text-2)" }}>Loading invite…</p>
        </main>
      </div>
    );
  }

  // ─── Redeem ───────────────────────────────────────────────────────────
  return (
    <div className="sobre-app">
      <TopBar wallet={wallet} walletState={state} contractId={contractId} />
      {isSubaccountInvite ? (
        <SubaccountJoinForm
          userAddress={address}
          state={state}
          contractId={contractId}
          inviteToken={inviteToken}
          onSuccess={() => {
            setRedeeming(true);
            router.replace(`/dashboard/${contractId}`);
          }}
          onCancel={() => router.replace("/dashboard")}
        />
      ) : (
        <JoinForm
          userAddress={address}
          state={state}
          contractId={contractId}
          inviteToken={inviteToken}
          onSuccess={() => {
            setRedeeming(true);
            router.replace(`/dashboard/${contractId}`);
          }}
          onCancel={() => router.replace("/dashboard")}
        />
      )}
    </div>
  );
}
