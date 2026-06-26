"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, Plus, UserPlus } from "lucide-react";

import { EnvelopeNamesForm } from "@/components/EnvelopeNamesForm";
import { EnvelopeSplitForm } from "@/components/EnvelopeSplitForm";
import { PendingRequestsPanel } from "@/components/PendingRequestsPanel";
import { PolicySettingsForm } from "@/components/PolicySettingsForm";
import { UpgradeAvailableCard } from "@/components/UpgradeAvailableCard";
import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import { CloseWalletModal } from "@/components/sobre/CloseWalletModal";
import { PdaxDepositModal } from "@/components/sobre/PdaxDepositModal";
import { PdaxWithdrawModal } from "@/components/sobre/PdaxWithdrawModal";
import { DashboardSkeleton } from "@/components/sobre/Skeletons";
import { EnvelopeCard } from "@/components/sobre/EnvelopeCard";
import { InviteModal } from "@/components/sobre/InviteModal";
import { Celebration, HeroPulse } from "@/components/sobre/Overlays";
import { RemoveMemberModal } from "@/components/sobre/RemoveMemberModal";
import { SignInPanel } from "@/components/sobre/SignInPanel";
import { SpendModal } from "@/components/sobre/SpendModal";
import { SummaryCard } from "@/components/sobre/SummaryCard";
import { TopBar } from "@/components/sobre/TopBar";
import type { Member } from "@/hooks/useWalletState";

import { useActiveCashouts } from "@/hooks/useActiveCashouts";
import { useActiveDeposits } from "@/hooks/useActiveDeposits";
import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { useRemoveMember } from "@/hooks/useRemoveMember";
import { useTxFeed } from "@/hooks/useTxFeed";
import { useWalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { isSobreClosed } from "@/lib/closedSobres";
import { forgetJoinedSobre } from "@/lib/joinedSobres";
import { PHP_PER_USDC } from "@/lib/config";

type Tab = "envelopes" | "settings";
const SETTINGS_HASH = "#settings";

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
  const wallet = usePasskeyWallet();
  const { address } = wallet;
  const walletState = useWalletState(address, contractId);
  const txFeed = useTxFeed(contractId);
  const state = walletState.state;

  const refresh = () => void walletState.refresh();
  const refreshAll = () => {
    void walletState.refresh();
    void txFeed.refresh();
    void activeDeposits.refresh();
    void activeCashouts.refresh();
  };

  const isAdmin = Boolean(state && address && state.admin === address);
  const isMember = Boolean(
    state && address && state.members.some((m) => m.address === address),
  );

  // Kicked-member cleanup: when state has loaded and confirms this address
  // isn't a member, drop any localStorage joined-Sobre entry so "My Sobres"
  // stops listing it.
  useEffect(() => {
    if (!state || !address) return;
    if (isMember) return;
    forgetJoinedSobre(address, contractId);
  }, [state, address, isMember, contractId]);

  const [depositOpen, setDepositOpen] = useState(false);
  // Identifier of an existing pdax_deposits row to resume into. When set,
  // the modal hydrates from that row and lands on whichever step matches
  // its status — e.g. ConfirmStep for a row at `credited`. Cleared on
  // close so a fresh "Add money" click starts a new flow.
  const [resumeDepositId, setResumeDepositId] = useState<string | null>(null);
  // Identifier of the row the deposit modal is currently working on,
  // surfaced via PdaxDepositModal.onActiveIdentifierChange. Used to
  // filter out the in-modal row from the PENDING bucket in the activity
  // feed so the same deposit doesn't render in two places at once.
  const [activeDepositId, setActiveDepositId] = useState<string | null>(null);
  const activeDeposits = useActiveDeposits(contractId);
  const [cashoutOpen, setCashoutOpen] = useState(false);
  const [resumeCashoutId, setResumeCashoutId] = useState<string | null>(null);
  const [activeCashoutId, setActiveCashoutId] = useState<string | null>(null);
  const activeCashouts = useActiveCashouts(contractId);
  const [spendOpen, setSpendOpen] = useState<EnvelopeName | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [heroPulse, setHeroPulse] = useState(false);
  const [envelopesPulsing, setEnvelopesPulsing] = useState(false);
  const [tab, setTab] = useState<Tab>("envelopes");
  // Hash-sync the tab so refresh + back-button keep the user where they were.
  useEffect(() => {
    const fromHash = (): Tab =>
      window.location.hash === SETTINGS_HASH ? "settings" : "envelopes";
    setTab(fromHash());
    const handler = () => setTab(fromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    history.replaceState(
      null,
      "",
      next === "settings"
        ? SETTINGS_HASH
        : window.location.pathname + window.location.search,
    );
  };
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

  const handleDepositSuccess = (usdcDeposited: number) => {
    setDepositOpen(false);
    triggerHeroAnimation();
    flash(`+ ${usdcDeposited.toFixed(2)} USDC auto-split across envelopes`, "ok");
    refreshAll();
  };

  const handleSpendSuccess = (info: {
    willGoPending: boolean;
    amount: bigint;
    envelope: EnvelopeName;
  }) => {
    setSpendOpen(null);
    const php = (Number(info.amount) / STROOPS_PER_USDC) * PHP_PER_USDC;
    const fmtPhp = `₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const envLabel = state
      ? displayEnvelopeName(info.envelope, state.envelope_names)
      : info.envelope;
    if (info.willGoPending) {
      flash(
        `Withdrawal request for ${fmtPhp} from ${envLabel} sent for approval`,
        "warn",
      );
    } else {
      flash(`Spent ${fmtPhp} from ${envLabel}`, "ok");
    }
    refreshAll();
  };

  const handleKick = (memberAddress: string) => {
    const member = state?.members.find((m) => m.address === memberAddress);
    if (!member || kickPending) return;
    setRemoveTarget(member);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const label = removeTarget.name || removeTarget.address;
    try {
      await removeMember(removeTarget.address);
      setRemoveTarget(null);
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
              src="/sobre-logo2.svg"
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

  // ─── Phase 1: not signed in / wallet bootstrapping ────────────────────
  if (!address) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
        <main className="flex-1 grid place-items-center px-6">
          <SignInPanel wallet={wallet} title="Sign in to open this Sobre" />
        </main>
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
              src="/sobre-logo2.svg"
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
        className="mx-auto w-full px-4 sm:px-7 pt-5"
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

      <nav
        className="sobre-tabs mx-auto w-full px-4 sm:px-7 pt-4"
        style={{ maxWidth: 1320 }}
      >
        <button
          type="button"
          className="sobre-tab"
          data-active={tab === "envelopes" ? "true" : "false"}
          onClick={() => switchTab("envelopes")}
        >
          Envelopes
        </button>
        <button
          type="button"
          className="sobre-tab"
          data-active={tab === "settings" ? "true" : "false"}
          onClick={() => switchTab("settings")}
        >
          Settings
        </button>
      </nav>

      {tab === "envelopes" ? (
      <div className="sobre-dash has-bottom-bar">
        <SummaryCard
          state={state}
          address={address}
          onDeposit={() => setDepositOpen(true)}
          onCashout={() => setCashoutOpen(true)}
          dailySpent={dailySpent}
          onKick={isAdmin ? handleKick : undefined}
          onInvite={isAdmin ? () => setInviteOpen(true) : undefined}
        >
          {state.pending.length > 0 ? (
            <div className="sobre-admin-section sobre-card-flat">
              <h3>Pending approvals ({state.pending.length})</h3>
              <PendingRequestsPanel
                userAddress={address}
                contractId={contractId}
                isAdmin={isAdmin}
                pending={state.pending}
                members={state.members}
                envelopeNames={state.envelope_names}
                onSuccess={refreshAll}
              />
            </div>
          ) : null}
        </SummaryCard>

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
                envelopeNames={state.envelope_names}
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
          envelopeNames={state.envelope_names}
          pendingDeposits={activeDeposits.deposits.filter(
            (d) => d.identifier !== activeDepositId,
          )}
          pendingCashouts={activeCashouts.cashouts.filter(
            (c) => c.identifier !== activeCashoutId,
          )}
          onResumeCashout={(identifier) => {
            setResumeCashoutId(identifier);
            setCashoutOpen(true);
          }}
          onResumeDeposit={(identifier) => {
            setResumeDepositId(identifier);
            setDepositOpen(true);
          }}
          onCancelDeposit={async (identifier) => {
            try {
              await fetch(
                `/api/pdax/deposits/${identifier}/cancel`,
                { method: "POST" },
              );
              flash("Deposit cancelled.", "warn");
            } finally {
              await activeDeposits.refresh();
            }
          }}
        />
      </div>
      ) : null}

      {tab === "settings" ? (
      <section
        className="mx-auto w-full px-4 sm:px-7 pb-12 pt-4"
        style={{ maxWidth: 1320 }}
      >
        <UpgradeAvailableCard
          userAddress={address}
          contractId={contractId}
          isAdmin={isAdmin}
          onSuccess={refreshAll}
        />
        <div
          className="grid gap-5"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          }}
        >
          <div className="sobre-admin-section sobre-card-flat">
            <h3>Spending policy</h3>
            <PolicySettingsForm
              userAddress={address}
              contractId={contractId}
              isAdmin={isAdmin}
              current={state.policy}
              envelopeNames={state.envelope_names}
              onSuccess={refresh}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Envelope names</h3>
            <EnvelopeNamesForm
              userAddress={address}
              contractId={contractId}
              isAdmin={isAdmin}
              current={state.envelope_names}
              onSuccess={refresh}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Envelope split</h3>
            <EnvelopeSplitForm
              userAddress={address}
              contractId={contractId}
              isAdmin={isAdmin}
              current={state.percents}
              envelopeNames={state.envelope_names}
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
                style={{ padding: "12px 18px", fontSize: 14 }}
              >
                Close wallet
              </button>
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {/* App-first thumb-zone action bar (phones/tablets only). Mirrors the
          primary actions that otherwise live in the SummaryCard, kept one
          tap away while the dashboard scrolls. Hidden on desktop via CSS. */}
      {tab === "envelopes" ? (
        <div className="sobre-bottom-bar">
          <div className="sobre-bottom-actions">
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="sobre-btn sobre-btn-soft"
                style={{ justifyContent: "center", minHeight: 48 }}
              >
                <UserPlus size={18} strokeWidth={2} />
                Invite
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDepositOpen(true)}
              className="sobre-bottom-cta"
            >
              <Plus size={18} strokeWidth={2.4} />
              Add money
            </button>
          </div>
        </div>
      ) : null}

      {heroPulse ? <HeroPulse /> : null}
      {celebration ? (
        <Celebration message={celebration.msg} kind={celebration.kind} />
      ) : null}

      {depositOpen ? (
        <PdaxDepositModal
          userAddress={address}
          state={state}
          contractId={contractId}
          resumeIdentifier={resumeDepositId ?? undefined}
          onActiveIdentifierChange={setActiveDepositId}
          onClose={() => {
            setDepositOpen(false);
            setResumeDepositId(null);
            void activeDeposits.refresh();
          }}
          onCancelMidFlight={(identifier) => {
            setDepositOpen(false);
            setResumeDepositId(null);
            flash("Deposit cancelled.", "warn");
            // Cancel-then-refresh in sequence so the row is `failed`
            // server-side by the time the active list re-reads. Doing
            // them in parallel left a stale `pending` row in PENDING.
            void (async () => {
              if (identifier) {
                try {
                  await fetch(`/api/pdax/deposits/${identifier}/cancel`, {
                    method: "POST",
                  });
                } catch {
                  // best effort; the TTL sweep will catch it eventually
                }
              }
              await activeDeposits.refresh();
            })();
          }}
          onSuccess={({ usdc }) => {
            setResumeDepositId(null);
            handleDepositSuccess(usdc);
          }}
        />
      ) : null}

      {cashoutOpen ? (
        <PdaxWithdrawModal
          userAddress={address}
          state={state}
          contractId={contractId}
          resumeIdentifier={resumeCashoutId ?? undefined}
          onActiveIdentifierChange={setActiveCashoutId}
          onClose={() => {
            setCashoutOpen(false);
            setResumeCashoutId(null);
            void activeCashouts.refresh();
          }}
          onCancelMidFlight={() => {
            // Locked modal — onCancelMidFlight never fires for cashouts now,
            // but keep the prop wired for prop-type compat with the modal.
            setCashoutOpen(false);
            setResumeCashoutId(null);
            flash("Cashout cancelled.", "warn");
          }}
          onSuccess={({ php }) => {
            setResumeCashoutId(null);
            flash(
              `₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2 })} sent to your bank`,
              "ok",
            );
            refreshAll();
          }}
        />
      ) : null}

      {spendOpen ? (
        <SpendModal
          userAddress={address}
          state={state}
          contractId={contractId}
          envelope={spendOpen}
          dailySpent={dailySpent}
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

      {removeTarget ? (
        <RemoveMemberModal
          member={removeTarget}
          walletName={state.wallet_name}
          pending={kickPending}
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => void confirmRemove()}
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
