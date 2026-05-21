"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, UserPlus } from "lucide-react";

import { PendingRequestsPanel } from "@/components/PendingRequestsPanel";
import { PolicySettingsForm } from "@/components/PolicySettingsForm";
import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import { CloseWalletModal } from "@/components/sobre/CloseWalletModal";
import { DepositModal } from "@/components/sobre/DepositModal";
import { EnvelopeCard } from "@/components/sobre/EnvelopeCard";
import { Fab } from "@/components/sobre/Fab";
import { InitForm } from "@/components/sobre/InitForm";
import { InviteModal } from "@/components/sobre/InviteModal";
import { JoinByLinkForm } from "@/components/sobre/JoinByLinkForm";
import { JoinForm } from "@/components/sobre/JoinForm";
import { WalletChooser } from "@/components/sobre/WalletChooser";
import { Celebration, HeroPulse } from "@/components/sobre/Overlays";
import { SpendModal } from "@/components/sobre/SpendModal";
import { SummaryCard } from "@/components/sobre/SummaryCard";
import { TopBar } from "@/components/sobre/TopBar";

import { useFreighter } from "@/hooks/useFreighter";
import { useRemoveMember } from "@/hooks/useRemoveMember";
import { useTxFeed } from "@/hooks/useTxFeed";
import { useWalletState } from "@/hooks/useWalletState";
import {
  CONTRACT_ID,
  ENVELOPE_LABELS,
  PHP_PER_XLM,
  STROOPS_PER_XLM,
  type EnvelopeName,
} from "@/lib/config";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <Dashboard />
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

function Dashboard() {
  const wallet = useFreighter();
  const { address } = wallet;
  const walletState = useWalletState(address);
  const txFeed = useTxFeed();
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
  const notInitialized =
    walletState.error?.includes("Error(Contract, #2)") ?? false;
  const isMember = Boolean(
    state && address && state.members.some((m) => m.address === address),
  );

  const [depositOpen, setDepositOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState<EnvelopeName | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  /** Routes the pre-dashboard handshake (after connect, before init/join). */
  const [chooserMode, setChooserMode] = useState<
    "chooser" | "new" | "join"
  >("chooser");
  const [heroPulse, setHeroPulse] = useState(false);
  const [envelopesPulsing, setEnvelopesPulsing] = useState(false);
  const [celebration, setCelebration] = useState<
    { msg: string; kind: "ok" | "warn" } | null
  >(null);

  const { removeMember, pending: kickPending } = useRemoveMember(address);

  const [newestTxHash, setNewestTxHash] = useState<string | null>(null);
  const seenHashesRef = useRef<Set<string>>(new Set());
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

  const totalStroops = useMemo(
    () => (state ? state.balances.reduce((acc, b) => acc + b, 0n) : 0n),
    [state],
  );

  // Sum stroops the connected user has spent today (UTC). Mirrors the
  // contract's DailySpent(caller, day_epoch) counter, derived from on-chain
  // events so the dashboard doesn't need a separate view call.
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
      // error logged on hook; surface via state revert
    }
  };

  // ─── Phase 1: not connected ───────────────────────────────────────────
  if (!address) {
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
              priority
              className="mx-auto"
            />
            <h1 className="font-serif text-[40px] font-semibold mt-5 mb-3 tracking-tight leading-[1.05]">
              Isang sobre.
              <br />
              Isang pamilya.
            </h1>
            <p
              className="text-[16px] mb-6"
              style={{ color: "var(--text-2)" }}
            >
              A joint Stellar wallet for OFW families. Connect your Freighter
              to open the dashboard.
            </p>
            {wallet.status === "not-installed" ? (
              <a
                href="https://www.freighter.app/"
                target="_blank"
                rel="noreferrer"
                className="sobre-btn sobre-btn-primary"
                style={{ padding: "14px 22px", fontSize: 15 }}
              >
                Install Freighter
                <ChevronRight size={16} strokeWidth={2.5} />
              </a>
            ) : (
              <Button onClick={wallet.connect} size="lg">
                Connect Wallet
              </Button>
            )}
            {wallet.error ? (
              <p
                className="text-xs mt-3"
                style={{ color: "var(--sobre-danger)" }}
              >
                {wallet.error}
              </p>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  // ─── Invite-link branch (highest priority) ────────────────────────────
  // If the URL is /dashboard?join=<thisContractId>, show the JoinForm — even
  // if the wallet is uninitialized (the JoinForm itself handles the various
  // edge cases like already-member or wallet-full). Other ?join values
  // (wrong contract) are ignored to avoid cross-wallet impersonation.
  const invitedToThisWallet = joinParam === CONTRACT_ID;
  if (invitedToThisWallet && state && !isMember) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} walletState={state} />
        <JoinForm
          userAddress={address}
          state={state}
          onSuccess={() => {
            refreshAll();
            flash("You're in. Welcome!", "ok");
            router.replace("/dashboard");
          }}
          onCancel={() => router.replace("/dashboard")}
        />
      </div>
    );
  }

  // ─── Loading branch ───────────────────────────────────────────────────
  // First poll hasn't returned yet — show a neutral loading screen rather
  // than flashing the chooser/init form for a beat.
  if (!state && !notInitialized) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <main className="flex-1 grid place-items-center px-6">
          <p style={{ color: "var(--text-2)" }}>Loading…</p>
        </main>
      </div>
    );
  }

  // ─── Connected but not a member of any Sobre ──────────────────────────
  // Chooser handshake: "open a new one" or "join an existing one via link."
  if (notInitialized || (state && !isMember)) {
    if (chooserMode === "new" && notInitialized) {
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
                priority
                className="mx-auto"
              />
              <h1 className="font-serif text-[36px] font-semibold mt-5 mb-3">
                Buksan ang sobre
              </h1>
              <p
                className="text-[16px] mb-6"
                style={{ color: "var(--text-2)" }}
              >
                Name your family&apos;s Sobre, name yourself, pick an emoji.
                You become the admin and can invite one family member.
              </p>
              <InitForm
                userAddress={address}
                onSuccess={() => {
                  refreshAll();
                  flash("Sobre opened — you are the admin", "ok");
                  setChooserMode("chooser");
                }}
              />
              <button
                type="button"
                onClick={() => setChooserMode("chooser")}
                className="mt-6 text-[13px]"
                style={{ color: "var(--text-2)" }}
              >
                ← Back
              </button>
            </div>
          </main>
        </div>
      );
    }
    if (chooserMode === "join") {
      return (
        <div className="sobre-app">
          <TopBar wallet={wallet} />
          <JoinByLinkForm
            onValid={(id) => {
              router.push(`/dashboard?join=${id}`);
            }}
            onBack={() => setChooserMode("chooser")}
          />
        </div>
      );
    }
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <WalletChooser
          canCreate={notInitialized}
          canJoin={Boolean(state)}
          onNew={() => setChooserMode("new")}
          onJoin={() => setChooserMode("join")}
        />
      </div>
    );
  }

  if (!state) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <main className="flex-1 grid place-items-center px-6">
          <p style={{ color: "var(--text-2)" }}>Loading wallet…</p>
        </main>
      </div>
    );
  }

  // ─── Phase 4: connected + initialized — the dashboard ──────────────────
  return (
    <div className="sobre-app">
      <TopBar
        wallet={wallet}
        walletState={state}
        isAdmin={isAdmin}
        onRenamed={refresh}
      />

      <div className="sobre-dash">
        <SummaryCard
          state={state}
          address={address}
          onDeposit={() => setDepositOpen(true)}
          dailySpent={dailySpent}
          onKick={isAdmin ? handleKick : undefined}
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
        <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
          <h2 className="font-serif text-[22px] font-semibold">
            Wallet controls
          </h2>
          {isAdmin && state.members.length < 2 ? (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="sobre-btn sobre-btn-soft"
              style={{ padding: "10px 16px", fontSize: 13 }}
            >
              <UserPlus size={14} strokeWidth={2} />
              Invite a member
            </button>
          ) : null}
        </div>
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
              isAdmin={isAdmin}
              pending={state.pending}
              onSuccess={refreshAll}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Spending policy</h3>
            <PolicySettingsForm
              userAddress={address}
              isAdmin={isAdmin}
              current={state.policy}
              onSuccess={refresh}
            />
          </div>
        </div>

        {isAdmin ? (
          <div className="mt-8 pt-6 border-t" style={{ borderColor: "var(--border)" }}>
            <h3 className="font-serif text-[16px] font-semibold mb-2" style={{ color: "var(--sobre-danger)" }}>
              Danger zone
            </h3>
            <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
              Sweep every envelope back to your address. The wallet stays
              callable but every balance returns to zero.
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

        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1.5 text-[13px]"
          style={{ color: "var(--text-2)" }}
        >
          <ChevronLeft size={14} />
          Back to landing
        </Link>
      </section>

      <Fab onClick={() => setDepositOpen(true)} />

      {heroPulse ? <HeroPulse /> : null}
      {celebration ? (
        <Celebration message={celebration.msg} kind={celebration.kind} />
      ) : null}

      {depositOpen ? (
        <DepositModal
          userAddress={address}
          state={state}
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
          envelope={spendOpen}
          onClose={() => setSpendOpen(null)}
          onSuccess={handleSpendSuccess}
        />
      ) : null}

      {inviteOpen ? (
        <InviteModal
          walletName={state.wallet_name}
          contractId={CONTRACT_ID}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}

      {closeOpen ? (
        <CloseWalletModal
          adminAddress={address}
          state={state}
          onClose={() => setCloseOpen(false)}
          onSuccess={() => {
            setCloseOpen(false);
            flash("Wallet closed — funds swept back to your address", "ok");
            refreshAll();
          }}
        />
      ) : null}

      {/* Used by the seen-hashes ref via totalStroops; lint guard noise. */}
      <div hidden>{totalStroops.toString()}</div>
    </div>
  );
}
