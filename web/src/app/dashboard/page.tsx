"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AddMemberForm } from "@/components/AddMemberForm";
import { PendingRequestsPanel } from "@/components/PendingRequestsPanel";
import { PolicySettingsForm } from "@/components/PolicySettingsForm";
import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import { DepositModal } from "@/components/sobre/DepositModal";
import { EnvelopeCard } from "@/components/sobre/EnvelopeCard";
import { Fab } from "@/components/sobre/Fab";
import { Celebration, HeroPulse } from "@/components/sobre/Overlays";
import { SpendModal } from "@/components/sobre/SpendModal";
import { SummaryCard } from "@/components/sobre/SummaryCard";
import { TopBar } from "@/components/sobre/TopBar";

import { useFreighter } from "@/hooks/useFreighter";
import { useInit } from "@/hooks/useInit";
import { useTxFeed } from "@/hooks/useTxFeed";
import { useWalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_XLM,
  STROOPS_PER_XLM,
  type EnvelopeName,
} from "@/lib/config";
import { Button } from "@/components/ui/button";

export default function Home() {
  const wallet = useFreighter();
  const { address } = wallet;
  const walletState = useWalletState(address);
  const txFeed = useTxFeed();
  const state = walletState.state;
  const refresh = () => void walletState.refresh();
  const refreshAll = () => {
    void walletState.refresh();
    void txFeed.refresh();
  };

  const isAdmin = Boolean(state && address && state.admin === address);
  const notInitialized =
    walletState.error?.includes("Error(Contract, #2)") ?? false;

  const [depositOpen, setDepositOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState<EnvelopeName | null>(null);
  const [heroPulse, setHeroPulse] = useState(false);
  const [envelopesPulsing, setEnvelopesPulsing] = useState(false);
  const [celebration, setCelebration] = useState<
    { msg: string; kind: "ok" | "warn" } | null
  >(null);

  // Newest tx hash that crossed the wire since the page rendered, used to
  // highlight the freshest activity-feed entry with the slide-in animation.
  const [newestTxHash, setNewestTxHash] = useState<string | null>(null);
  const seenHashesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (txFeed.events.length === 0) return;
    const head = txFeed.events[0];
    if (!seenHashesRef.current.has(head.txHash)) {
      // First render: seed without highlighting historical events.
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
      flash(`Approval requested — ${fmtPhp} from ${info.envelope}`, "warn");
    } else {
      flash(`Spent ${fmtPhp} from ${info.envelope}`, "ok");
    }
    refreshAll();
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

  // ─── Phase 2: connected but contract not initialized ──────────────────
  if (notInitialized) {
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
              You&apos;re the admin of a fresh wallet on Stellar testnet.
              Initialize with the default 50 / 30 / 20 split across Groceries,
              Tuition, and Savings.
            </p>
            <InitButton
              address={address}
              onSuccess={() => {
                refreshAll();
                flash("Wallet initialized — you are the admin", "ok");
              }}
            />
          </div>
        </main>
      </div>
    );
  }

  // ─── Phase 3: loading state (before first poll) ────────────────────────
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
      <TopBar wallet={wallet} />

      <div className="sobre-dash">
        <SummaryCard
          state={state}
          address={address}
          onDeposit={() => setDepositOpen(true)}
          dailySpent={dailySpent}
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

          {state.balances.map((bal, i) => (
            <EnvelopeCard
              key={i}
              index={i}
              balanceStroops={bal}
              percent={state.percents[i] ?? 0}
              pulsing={envelopesPulsing}
              onSpend={() => setSpendOpen(ENVELOPE_LABELS[i])}
            />
          ))}
        </div>

        <ActivityFeed
          events={txFeed.events}
          loading={txFeed.loading}
          error={txFeed.error}
          newestTxHash={newestTxHash}
        />
      </div>

      {/* Wallet controls — full-width section below the 3-column grid.
          Pending approvals always shown (members see their own status, admin
          gets approve/deny buttons); spending policy is editable for admin
          and read-only for members; add-member is admin-only and only while
          there's room left. */}
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

          {isAdmin && state.members.length < 2 ? (
            <div className="sobre-admin-section sobre-card-flat">
              <h3>Add a member</h3>
              <AddMemberForm userAddress={address} onSuccess={refresh} />
            </div>
          ) : null}
        </div>

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
    </div>
  );
}

function InitButton({
  address,
  onSuccess,
}: {
  address: string;
  onSuccess: () => void;
}) {
  const { init, pending, error } = useInit(address);
  return (
    <>
      <button
        onClick={async () => {
          try {
            await init();
            onSuccess();
          } catch {
            // error on hook
          }
        }}
        disabled={pending}
        className="sobre-btn sobre-btn-primary"
        style={{ padding: "14px 22px", fontSize: 15 }}
      >
        {pending ? "Initializing…" : "Initialize wallet (50 / 30 / 20)"}
      </button>
      {error ? (
        <p
          className="text-xs mt-3 break-all"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
