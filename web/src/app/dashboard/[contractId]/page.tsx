"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";

import { EnvelopeSplitForm } from "@/components/EnvelopeSplitForm";
import { PendingRequestsPanel } from "@/components/PendingRequestsPanel";
import { PolicySettingsForm } from "@/components/PolicySettingsForm";
import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import { CloseWalletModal } from "@/components/sobre/CloseWalletModal";
import { DepositModal } from "@/components/sobre/DepositModal";
import { DashboardSkeleton } from "@/components/sobre/Skeletons";
import { EnvelopeCard } from "@/components/sobre/EnvelopeCard";
import { InviteModal } from "@/components/sobre/InviteModal";
import { JoinForm } from "@/components/sobre/JoinForm";
import { Celebration, HeroPulse } from "@/components/sobre/Overlays";
import { SpendModal } from "@/components/sobre/SpendModal";
import { SummaryCard } from "@/components/sobre/SummaryCard";
import { TopBar } from "@/components/sobre/TopBar";

import { useFreighter } from "@/hooks/useFreighter";
import { useRemoveMember } from "@/hooks/useRemoveMember";
import { useTxFeed } from "@/hooks/useTxFeed";
import { useWalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_XLM,
  STROOPS_PER_XLM,
  type EnvelopeName,
} from "@/lib/config";
import { isSobreClosed } from "@/lib/closedSobres";
import { rememberJoinedSobre } from "@/lib/joinedSobres";

interface RouteParams {
  contractId: string;
}

export default function DashboardPage(props: { params: Promise<RouteParams> }) {
  const { contractId } = use(props.params);
  return (
    <Suspense fallback={<DashboardLoading />}>
      <Dashboard contractId={contractId} />
    </Suspense>
  );
}

function DashboardLoading() {
  return (
    <div className="sobre-app">
      <main className="flex-1 grid place-items-center px-6">
        <p style={{ color: "var(--text-2)" }}>Loading…</p>
      </main>
    </div>
  );
}

function Dashboard({ contractId }: { contractId: string }) {
  const wallet = useFreighter();
  const { address } = wallet;
  const walletState = useWalletState(address, contractId);
  const txFeed = useTxFeed(contractId);
  const state = walletState.state;
  const router = useRouter();
  const searchParams = useSearchParams();
  const joinParam = searchParams.get("join");

  const refresh = () => void walletState.refresh();
  const refreshAll = () => {
    void walletState.refresh();
    void txFeed.refresh();
  };

  const isAdmin = Boolean(state && address && state.admin === address);
  const isMember = Boolean(
    state && address && state.members.some((m) => m.address === address),
  );

  const [depositOpen, setDepositOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState<EnvelopeName | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [heroPulse, setHeroPulse] = useState(false);
  const [envelopesPulsing, setEnvelopesPulsing] = useState(false);
  const [celebration, setCelebration] = useState<
    { msg: string; kind: "ok" | "warn" } | null
  >(null);

  const { removeMember, pending: kickPending } = useRemoveMember(
    address,
    contractId,
  );

  const [newestTxHash, setNewestTxHash] = useState<string | null>(null);
  const seenHashesRef = useRef<Set<string>>(new Set());
  // null = haven't checked localStorage yet (SSR pass + first client render).
  // The closed-Sobre guard below short-circuits to its screen only once we've
  // confirmed via useEffect that the contract is locally marked closed.
  const [closed, setClosed] = useState<boolean | null>(null);
  useEffect(() => {
    setClosed(isSobreClosed(contractId));
  }, [contractId]);
  useEffect(() => {
    if (txFeed.events.length === 0) return;
    const head = txFeed.events[0];
    if (!seenHashesRef.current.has(head.txHash)) {
      if (seenHashesRef.current.size === 0) {
        for (const ev of txFeed.events) seenHashesRef.current.add(ev.txHash);
        return;
      }
      seenHashesRef.current.add(head.txHash);
      setNewestTxHash(head.txHash);
      const t = setTimeout(() => setNewestTxHash(null), 800);
      return () => clearTimeout(t);
    }
  }, [txFeed.events]);

  const flash = (msg: string, kind: "ok" | "warn" = "ok") => {
    setCelebration({ msg, kind });
    setTimeout(() => setCelebration(null), 2400);
  };

  const triggerHeroAnimation = () => {
    setHeroPulse(true);
    setEnvelopesPulsing(true);
    setTimeout(() => setHeroPulse(false), 1500);
    setTimeout(() => setEnvelopesPulsing(false), 1300);
  };

  const dailySpent = useMemo(() => {
    if (!address) return 0n;
    const now = new Date();
    const todayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
    let sum = 0n;
    for (const ev of txFeed.events) {
      if (ev.kind !== "Spend") continue;
      if (ev.caller !== address) continue;
      const d = new Date(ev.ledgerClosedAt);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      if (key === todayKey) sum += ev.amount;
    }
    return sum;
  }, [txFeed.events, address]);

  const handleDepositSuccess = (xlmDeposited: number) => {
    setDepositOpen(false);
    triggerHeroAnimation();
    flash(`+ ${xlmDeposited.toFixed(2)} XLM auto-split across envelopes`, "ok");
    refreshAll();
  };

  const handleSpendSuccess = (info: {
    willGoPending: boolean;
    amount: bigint;
    envelope: EnvelopeName;
  }) => {
    setSpendOpen(null);
    const php = (Number(info.amount) / STROOPS_PER_XLM) * PHP_PER_XLM;
    const fmtPhp = `₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (info.willGoPending) {
      flash(
        `Withdrawal request for ${fmtPhp} from ${info.envelope} sent for approval`,
        "warn",
      );
    } else {
      flash(`Spent ${fmtPhp} from ${info.envelope}`, "ok");
    }
    refreshAll();
  };

  const handleKick = async (memberAddress: string) => {
    const member = state?.members.find((m) => m.address === memberAddress);
    const label = member?.name || memberAddress;
    if (kickPending) return;
    if (!window.confirm(`Remove ${label} from this wallet?`)) return;
    try {
      await removeMember(memberAddress);
      flash(`${label} removed`, "warn");
      refreshAll();
    } catch {
      // surfaces via state poll
    }
  };

  // ─── Closed Sobre branch ──────────────────────────────────────────────
  // localStorage flag is set by CloseWalletModal after a successful sweep.
  // The contract still allows operations technically, but the dashboard
  // refuses to render the live UI and shows a closed-state screen instead.
  if (closed) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <main className="flex-1 grid place-items-center px-6">
          <div className="text-center max-w-md">
            <Image
              src="/sobre-logo.svg"
              alt=""
              width={56}
              height={56}
              className="mx-auto opacity-50"
            />
            <h1 className="font-serif text-[30px] font-semibold mt-5 mb-3">
              This Sobre is closed
            </h1>
            <p
              className="text-[14px] mb-5"
              style={{ color: "var(--text-2)" }}
            >
              The admin closed this wallet and swept all funds back. It can&apos;t
              be reopened.
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

  // ─── Phase 1: not connected ───────────────────────────────────────────
  if (!address) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <main className="flex-1 grid place-items-center px-6">
          <div className="text-center max-w-md">
            <h1 className="font-serif text-[32px] font-semibold mb-3">
              Connect your wallet
            </h1>
            <p className="text-[15px]" style={{ color: "var(--text-2)" }}>
              You need to connect Freighter to open this Sobre.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ─── Phase 2: invite-link landed here ─────────────────────────────────
  const invitedHere = joinParam === contractId;
  if (invitedHere && state && !isMember) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} walletState={state} contractId={contractId} />
        <JoinForm
          userAddress={address}
          state={state}
          contractId={contractId}
          onSuccess={() => {
            rememberJoinedSobre(address, contractId);
            refreshAll();
            flash("You're in. Welcome!", "ok");
            router.replace(`/dashboard/${contractId}`);
          }}
          onCancel={() => router.replace(`/dashboard/${contractId}`)}
        />
      </div>
    );
  }

  // ─── Loading branch ───────────────────────────────────────────────────
  if (!state) {
    const isUninitialized =
      walletState.error?.includes("Error(Contract, #2)") ?? false;
    if (isUninitialized) {
      return (
        <div className="sobre-app">
          <TopBar wallet={wallet} />
          <main className="flex-1 grid place-items-center px-6">
            <div className="text-center max-w-md">
              <h1 className="font-serif text-[28px] font-semibold mb-3">
                This Sobre isn&apos;t open yet
              </h1>
              <p className="text-[14px]" style={{ color: "var(--text-2)" }}>
                The contract at this address hasn&apos;t been initialized. Ask
                the admin to share their invite link, or open your own Sobre.
              </p>
              <Link
                href="/dashboard"
                className="sobre-btn sobre-btn-soft mt-4"
                style={{ padding: "10px 16px", fontSize: 13 }}
              >
                Back to My Sobres
              </Link>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <DashboardSkeleton />
      </div>
    );
  }

  // ─── Connected but not a member of THIS Sobre ─────────────────────────
  if (!isMember) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} walletState={state} contractId={contractId} />
        <main className="flex-1 grid place-items-center px-6">
          <div className="text-center max-w-md">
            <Image
              src="/sobre-logo.svg"
              alt=""
              width={56}
              height={56}
              className="mx-auto"
            />
            <h1 className="font-serif text-[28px] font-semibold mt-5 mb-3">
              You&apos;re not in <em>{state.wallet_name}</em>
            </h1>
            <p
              className="text-[14px] mb-5"
              style={{ color: "var(--text-2)" }}
            >
              The admin needs to share their invite link with you before you
              can join.
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

  // ─── Full dashboard ───────────────────────────────────────────────────
  return (
    <div className="sobre-app">
      <TopBar
        wallet={wallet}
        walletState={state}
        contractId={contractId}
        isAdmin={isAdmin}
        onRenamed={refresh}
      />

      <div
        className="mx-auto w-full px-7 pt-5"
        style={{ maxWidth: 1320 }}
      >
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px]"
          style={{ color: "var(--text-2)" }}
        >
          <ChevronLeft size={14} />
          My Sobres
        </Link>
      </div>

      <div className="sobre-dash">
        <SummaryCard
          state={state}
          address={address}
          onDeposit={() => setDepositOpen(true)}
          dailySpent={dailySpent}
          onKick={isAdmin ? handleKick : undefined}
          onInvite={isAdmin ? () => setInviteOpen(true) : undefined}
        />

        <div className="sobre-envs">
          <header className="flex items-end justify-between mb-5">
            <div>
              <h2>Envelopes</h2>
              <p className="sub">
                Money split automatically the moment a remittance lands.
              </p>
            </div>
          </header>

          {state.balances.map((bal, i) => {
            const envName = ENVELOPE_LABELS[i];
            const approvalRequired =
              state.policy.require_all_sigs ||
              state.policy.protected_envelopes.includes(envName);
            return (
              <EnvelopeCard
                key={i}
                index={i}
                balanceStroops={bal}
                percent={state.percents[i] ?? 0}
                pulsing={envelopesPulsing}
                onSpend={() => setSpendOpen(envName)}
                approvalRequired={approvalRequired}
                events={txFeed.events}
                members={state.members}
              />
            );
          })}
        </div>

        <ActivityFeed
          events={txFeed.events}
          loading={txFeed.loading}
          error={txFeed.error}
          newestTxHash={newestTxHash}
          members={state.members}
        />
      </div>

      <section
        className="mx-auto w-full px-7 pb-12"
        style={{ maxWidth: 1320 }}
      >
        <h2 className="font-serif text-[22px] font-semibold mb-4">
          Wallet controls
        </h2>
        <div
          className="grid gap-5"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          }}
        >
          <div className="sobre-admin-section sobre-card-flat">
            <h3>
              Pending approvals{" "}
              {state.pending.length > 0
                ? `(${state.pending.length})`
                : ""}
            </h3>
            <PendingRequestsPanel
              userAddress={address}
              contractId={contractId}
              isAdmin={isAdmin}
              pending={state.pending}
              onSuccess={refreshAll}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Envelope split</h3>
            <EnvelopeSplitForm
              userAddress={address}
              contractId={contractId}
              isAdmin={isAdmin}
              current={state.percents}
              onSuccess={refresh}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Spending policy</h3>
            <PolicySettingsForm
              userAddress={address}
              contractId={contractId}
              isAdmin={isAdmin}
              current={state.policy}
              onSuccess={refresh}
            />
          </div>

          {isAdmin ? (
            <div
              className="sobre-admin-section sobre-card-flat"
              style={{ borderColor: "#e8b9b0", background: "#fffaf8" }}
            >
              <h3
                className="inline-flex items-center gap-2"
                style={{ color: "var(--sobre-danger)" }}
              >
                <AlertTriangle size={14} strokeWidth={2.2} />
                Close this Sobre
              </h3>
              <p
                className="text-xs mt-1 mb-4"
                style={{ color: "var(--text-2)" }}
              >
                All funds return to you. Members lose access.
              </p>
              <button
                type="button"
                onClick={() => setCloseOpen(true)}
                className="sobre-btn sobre-btn-danger"
                style={{ padding: "10px 16px", fontSize: 13 }}
              >
                Close wallet
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {heroPulse ? <HeroPulse /> : null}
      {celebration ? (
        <Celebration message={celebration.msg} kind={celebration.kind} />
      ) : null}

      {depositOpen ? (
        <DepositModal
          userAddress={address}
          state={state}
          contractId={contractId}
          onClose={() => setDepositOpen(false)}
          onSuccess={({ xlm }) => {
            handleDepositSuccess(xlm);
          }}
        />
      ) : null}

      {spendOpen ? (
        <SpendModal
          userAddress={address}
          state={state}
          contractId={contractId}
          envelope={spendOpen}
          onClose={() => setSpendOpen(null)}
          onSuccess={handleSpendSuccess}
        />
      ) : null}

      {inviteOpen ? (
        <InviteModal
          walletName={state.wallet_name}
          contractId={contractId}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}

      {closeOpen ? (
        <CloseWalletModal
          adminAddress={address}
          state={state}
          contractId={contractId}
          onClose={() => setCloseOpen(false)}
          onSuccess={() => {
            setCloseOpen(false);
            flash("Wallet closed — funds swept back to your address", "ok");
            setClosed(true);
            refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}
