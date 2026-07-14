"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  GearSixIcon,
  PencilSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import { EnvelopeNamesForm } from "@/components/EnvelopeNamesForm";
import { EnvelopeSplitForm } from "@/components/EnvelopeSplitForm";
import { CashoutApprovalBanner } from "@/components/sobre/CashoutApprovalBanner";
import { TransferBetweenEnvelopesModal } from "@/components/sobre/TransferBetweenEnvelopesModal";
import { PolicySettingsForm } from "@/components/PolicySettingsForm";
import { usePendingCashoutApprovals } from "@/hooks/usePendingCashoutApprovals";
import { UpgradeAvailableCard } from "@/components/UpgradeAvailableCard";
import { ActivityFeed } from "@/components/sobre/ActivityFeed";
import { BackLink } from "@/components/sobre/BackLink";
import { BottomDock, type DockTab } from "@/components/sobre/BottomDock";
import { SupplementarySummary } from "@/components/sobre/SupplementarySummary";
import { EarnGrowSummary } from "@/components/sobre/EarnGrowSummary";
import { EarnInfoModal } from "@/components/sobre/EarnInfoModal";
import { EarnPanel } from "@/components/sobre/EarnPanel";
import { GrowPanel } from "@/components/sobre/GrowPanel";
import { CurrencyToggle } from "@/components/sobre/CurrencyToggle";
import { BalanceHero } from "@/components/sobre/BalanceHero";
import { MembersSection } from "@/components/sobre/MembersSection";
import { OpenSobreSheet } from "@/components/sobre/OpenSobreSheet";
import { ProfileSheet } from "@/components/sobre/ProfileSheet";
import { Sheet } from "@/components/sobre/Sheet";
import { RecentActivityPreview } from "@/components/sobre/RecentActivityPreview";
import { SplitProposalCard } from "@/components/sobre/SplitProposalCard";
import { EnvelopeSplitCard } from "@/components/sobre/EnvelopeSplitCard";
import { RenameWalletModal } from "@/components/sobre/RenameWalletModal";
import { Reveal } from "@/components/sobre/Reveal";
import { SplitLegendBar } from "@/components/sobre/SplitLegendBar";
import { CloseWalletModal } from "@/components/sobre/CloseWalletModal";
import { PdaxDepositModal } from "@/components/sobre/PdaxDepositModal";
import { PdaxWithdrawModal } from "@/components/sobre/PdaxWithdrawModal";
import {
  DashboardSkeleton,
  type DashboardSkeletonTab,
} from "@/components/sobre/Skeletons";
import { EnvelopeCard } from "@/components/sobre/EnvelopeCard";
import { ExpenseQuickAdd } from "@/components/sobre/ExpenseQuickAdd";
import { ExpensesView } from "@/components/sobre/ExpensesView";
import { CurrencyProvider, useCurrency } from "@/lib/currency";
import { InviteModal } from "@/components/sobre/InviteModal";
import {
  Celebration,
  HeroPulse,
  TRUNCATE_CHAR_LIMIT,
} from "@/components/sobre/Overlays";
import { BankAccountSection } from "@/components/sobre/BankAccountSection";
import { EnvelopeActionsSheet } from "@/components/sobre/EnvelopeActionsSheet";
import { FundSubAccountModal } from "@/components/sobre/FundSubAccountModal";
import { SignInPanel } from "@/components/sobre/SignInPanel";
import { SubAccountsPanel } from "@/components/sobre/SubAccountsPanel";
import { SubAccountView } from "@/components/sobre/SubAccountView";
import { TopBar } from "@/components/sobre/TopBar";

import { useActiveCashouts } from "@/hooks/useActiveCashouts";
import { useActiveDeposits } from "@/hooks/useActiveDeposits";
import { useExpenseLog } from "@/hooks/useExpenseLog";
import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { useSplitProposals } from "@/hooks/useSplitProposals";
import { useSubaccounts } from "@/hooks/useSubaccounts";
import { useTxFeed } from "@/hooks/useTxFeed";
import { useWalletState } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS, type EnvelopeName } from "@/lib/config";
import { isSobreClosed } from "@/lib/closedSobres";
import { expenseLogsToFeedEvents } from "@/lib/expenseLogFeed";
import { forgetJoinedSobre } from "@/lib/joinedSobres";
import { envelopeTotalStroops } from "@/lib/walletTotals";

// Sourced from Skeletons so the shared shape stays a single truth — the
// skeleton needs the exact same tab set to render the right shape while
// state is loading. Aliased locally as `Tab` to keep call sites terse.
type Tab = DashboardSkeletonTab;
const SETTINGS_HASH = "#settings";
const ENVELOPES_HASH = "#envelopes";
const ACTIVITY_HASH = "#activity";
const PROFILE_HASH = "#profile";

/** Collapse the dashboard's fine-grained tabs onto the dock's four visible
 *  slots. Settings is reached from the Envelopes-tab gear, so its dock
 *  home stays "envelopes" — the highlight matches the parent surface the
 *  user came from and back-nav feels honest. */
function dockActive(tab: Tab): DockTab {
  if (tab === "envelopes" || tab === "settings") return "envelopes";
  if (tab === "activity") return "activity";
  if (tab === "profile") return "profile";
  return "home";
}

interface RouteParams {
  contractId: string;
}

export default function DashboardPage(props: { params: Promise<RouteParams> }) {
  const { contractId } = use(props.params);
  return (
    <CurrencyProvider>
      <Suspense fallback={<DashboardLoading />}>
        <Dashboard contractId={contractId} />
      </Suspense>
    </CurrencyProvider>
  );
}

function DashboardLoading() {
  // Same layout shell the real dashboard uses, with the tab-shaped skeleton
  // matching whichever tab the user is refreshing into. DashboardSkeleton
  // owns its own per-tab maxWidth wrapper so this fallback and the mounted
  // dashboard's skeleton land on identical pixels.
  return (
    <div className="sobre-app sobre-v2 has-dock">
      <DashboardSkeleton tab={tabFromHash()} />
    </div>
  );
}

/** Resolve the current tab from the URL hash. Safe to call from anywhere
 *  (including SSR / suspense fallbacks): returns "home" when `window` is
 *  absent instead of throwing. Used by both the Dashboard mount + the
 *  Suspense fallback so refresh always renders the right shape. */
function tabFromHash(hash?: string): DashboardSkeletonTab {
  const h =
    hash ?? (typeof window !== "undefined" ? window.location.hash : "");
  if (h === SETTINGS_HASH) return "settings";
  if (h === ENVELOPES_HASH) return "envelopes";
  if (h === ACTIVITY_HASH) return "activity";
  if (h === PROFILE_HASH) return "profile";
  return "home";
}

/** Underline tab used inside the Activity tab to toggle between the
 *  chronological Feed and the aggregated Expenses view. Text-only,
 *  mango-primary underline on the active one. Same rhythm as the rest
 *  of Sobre's minimal chrome. */
function ActivitySegment({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 0",
        marginBottom: -1,
        borderTop: 0,
        borderLeft: 0,
        borderRight: 0,
        borderBottom: active ? "2px solid var(--sobre-primary)" : "2px solid transparent",
        background: "transparent",
        color: active ? "var(--text-1)" : "var(--text-3)",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        transition: "color 160ms ease",
      }}
    >
      {label}
    </button>
  );
}

function Dashboard({ contractId }: { contractId: string }) {
  const wallet = usePasskeyWallet();
  const { address } = wallet;
  const walletState = useWalletState(address, contractId);
  const txFeed = useTxFeed(contractId);
  const state = walletState.state;
  const familyWalletId = walletState.familyWalletId;
  const expenseLogHook = useExpenseLog(familyWalletId);
  // Merge on-chain events with off-chain expense_logs, sorted newest-first
  // by ledgerClosedAt (occurred_at for logs, real ledger time for on-chain).
  const feedEvents = useMemo(() => {
    if (!state || !familyWalletId) return txFeed.events;
    const synth = expenseLogsToFeedEvents(
      expenseLogHook.logs,
      state.members,
      familyWalletId,
    );
    return [...txFeed.events, ...synth].sort((a, b) => {
      const ta = new Date(a.ledgerClosedAt).getTime();
      const tb = new Date(b.ledgerClosedAt).getTime();
      return tb - ta;
    });
  }, [txFeed.events, expenseLogHook.logs, state, familyWalletId]);
  const splitProposals = useSplitProposals(
    familyWalletId,
    wallet.wallet?.id ?? null,
  );
  const subaccountsHook = useSubaccounts(familyWalletId);
  const proposalNeedsMyVote = Boolean(
    splitProposals.pending && splitProposals.myVote === null,
  );
  const subRows = subaccountsHook.subaccounts;
  // Compact ref shape shared by the three activity surfaces (feed,
  // preview, expenses). Filters out subs without a wallet address and
  // fixes the shape in one place so future field additions don't have
  // to hunt through call sites.
  const subaccountRefs = useMemo(
    () =>
      subRows
        .filter((r) => r.walletAddress)
        .map((r) => ({
          address: r.walletAddress as string,
          name: r.displayName,
          avatarUrl: r.avatarUrl,
        })),
    [subRows],
  );

  // Multi-admin cashout approvals: any pending request the CURRENT
  // admin still owes their sign-off on. Non-admins get an empty
  // array. Renders as a stack of banners at the top of the Home tab.
  const pendingApprovals = usePendingCashoutApprovals({
    familyWalletId,
    currentWalletDbId: wallet.wallet?.id ?? null,
    currentIsAdmin: Boolean(
      state && address && state.admins.includes(address),
    ),
    totalAdmins: state?.admins.length ?? 0,
  });
  const memberDisplayFor = useCallback(
    (walletDbId: string): { name: string; avatarUrl: string | null } => {
      const m = state?.members.find((mem) => mem.walletDbId === walletDbId);
      return {
        name: m?.name ?? "An admin",
        avatarUrl: m?.avatarUrl ?? null,
      };
    },
    [state],
  );

  const refresh = () => void walletState.refresh();
  const refreshAll = () => {
    void walletState.refresh();
    void txFeed.refresh();
    void activeDeposits.refresh();
    void activeCashouts.refresh();
    // Realtime channel on family_subaccounts silently drops DELETE
    // events for rows RLS would hide, so cancel-invite / claim don't
    // always propagate. Explicit re-fetch keeps the supplementary list
    // in sync with the DB regardless.
    void subaccountsHook.refresh();
  };

  const isAdmin = Boolean(
    state && address && state.admins.includes(address),
  );
  const isMember = Boolean(
    state && address && state.members.some((m) => m.address === address),
  );
  const isSubaccount = Boolean(
    state &&
      address &&
      state.subaccounts.some((s) => s.address === address),
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
  // Identifiers the user has just clicked the trash on. Filtered out of
  // the PENDING bucket the instant the /cancel request kicks off so the
  // row unmounts without a race. Cleared once activeDeposits.refresh()
  // resolves, so a row that PDAX resurrects (payment landed late) shows
  // back up in the UI instead of staying stuck-invisible from a local
  // hidden flag that survived across the resurrection.
  const [cancelledDepositIds, setCancelledDepositIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Sub-account holders aren't family_members; the active deposits/cashouts
  // routes 403 their session every poll cycle. Pass null in that branch so
  // the hooks idle (they already handle null gracefully) instead of
  // spraying the console with rejected requests. Also gated on `state` —
  // until walletState's first poll lands we can't yet tell whether the
  // caller is a sub-account, and firing the hooks pre-emptively burns one
  // round of 403s on every JR refresh.
  const memberSideContractId =
    state && !isSubaccount ? contractId : null;
  const activeDeposits = useActiveDeposits(memberSideContractId);
  const [cashoutOpen, setCashoutOpen] = useState(false);
  const [resumeCashoutId, setResumeCashoutId] = useState<string | null>(null);
  const [activeCashoutId, setActiveCashoutId] = useState<string | null>(null);
  const activeCashouts = useActiveCashouts(memberSideContractId, {
    // Fires whenever a cashout the dashboard was tracking drops off the
    // active list because it hit `paid`. The modal's onSuccess only
    // fires while the modal is open; this covers the close-and-walk-
    // away path the new modal explicitly allows.
    onPaid: (row) => {
      flash(
        `₱${Number(row.amount_php ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })} landed in your bank`,
        "ok",
      );
    },
    onFailed: (row) => {
      flash(
        `Cashout of ₱${Number(row.amount_php ?? 0).toLocaleString("en-PH")} couldn't complete.`,
        "warn",
      );
      void row; // reserved for surfacing failure_reason later
    },
  });
  // Envelope-scoped action sheet + its two downstream modals. All three
  // states are envelope-anchored: which envelope did the user tap to
  // reach the action; if they chose Cash out, that envelope pre-selects
  // in PdaxWithdrawModal; if they chose Send, that envelope pre-selects
  // in FundSubAccountModal. Null means the modal is closed.
  const [envActionsFor, setEnvActionsFor] = useState<EnvelopeName | null>(
    null,
  );
  const [cashoutInitialEnvelope, setCashoutInitialEnvelope] =
    useState<EnvelopeName | undefined>(undefined);
  const [sendToSubFor, setSendToSubFor] = useState<EnvelopeName | null>(null);
  // Set when the OpenSobreSheet "Send" tile fires (no envelope preselected).
  // Distinct from `sendToSubFor` so the modal knows to render the envelope
  // picker instead of pinning to a specific envelope.
  const [sendToSubOpen, setSendToSubOpen] = useState(false);
  // Inter-Sobre transfer entry — envelope pre-selected from the
  // envelope actions sheet. Null closes the modal.
  const [transferForEnvelope, setTransferForEnvelope] =
    useState<EnvelopeName | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Household-policy dirty flag. Set true whenever PolicySettingsForm
  // carries unsaved changes; used to gate tab switches + BackLink with
  // a "save your changes?" confirm so an accidental navigation doesn't
  // lose an edit that wasn't yet posted to Supabase.
  const [policyDirty, setPolicyDirty] = useState(false);
  // "Log expense" quick-action tile → the off-chain note field in a modal.
  const [logExpenseOpen, setLogExpenseOpen] = useState(false);
  // Dock's center Sobre FAB opens the action sheet.
  const [sobreSheetOpen, setSobreSheetOpen] = useState(false);
  // Pencil on the balance hero → rename dialog (admin only).
  const [renameOpen, setRenameOpen] = useState(false);
  const [earnInfoOpen, setEarnInfoOpen] = useState(false);
  // Member drafts collected during onboarding, handed off via sessionStorage
  // and ?invite=1. Pre-fill the invite modal so the admin can mint each link
  // on demand (one passkey prompt per link — see docs/onboarding-plan.md).
  const [inviteSuggestions, setInviteSuggestions] = useState<
    { name: string; email: string; role: string }[]
  >([]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("invite") !== "1") return;
    const key = `sobre.onboarding.invites.${contractId}`;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time onboarding handoff read from sessionStorage
          setInviteSuggestions(
            parsed
              .filter(
                (m): m is { name: string; email?: string; role?: string } =>
                  !!m && typeof (m as { name?: unknown }).name === "string",
              )
              .map((m) => ({
                name: m.name,
                email: typeof m.email === "string" ? m.email : "",
                role: typeof m.role === "string" ? m.role : "recipient",
              })),
          );
        }
      }
      sessionStorage.removeItem(key);
    } catch {
      // storage unavailable / bad JSON — just open the empty invite modal
    }
    setInviteOpen(true);
    // Drop the query param so a refresh doesn't re-open the modal.
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
  }, [contractId]);
  const [closeOpen, setCloseOpen] = useState(false);
  const [heroPulse, setHeroPulse] = useState(false);
  // Display currency is app-wide via CurrencyContext (toggle lives in TopBar).
  const { currency } = useCurrency();
  // Read hash synchronously so the first render matches the URL — otherwise
  // the wrong tab flashes for one paint before the effect below flips it,
  // AND the DashboardSkeleton below picks the wrong shape while state loads.
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  // Activity tab has two sub-views: chronological Feed and aggregated
  // Expenses. Kept as a hash query so refresh + back button preserve it.
  const [activityView, setActivityView] = useState<"feed" | "expenses">(() =>
    typeof window !== "undefined" && window.location.hash.includes("view=expenses")
      ? "expenses"
      : "feed",
  );
  const switchActivityView = (next: "feed" | "expenses") => {
    setActivityView(next);
    const base = ACTIVITY_HASH;
    const hash = next === "expenses" ? `${base}?view=expenses` : base;
    history.replaceState(
      null,
      "",
      hash,
    );
  };
  // Hash-sync the tab so refresh + back-button keep the user where they were.
  useEffect(() => {
    const handler = () => setTab(tabFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  // Browser-level guard for unsaved policy edits. The dashboard's own
  // `switchTab` handles in-app navigation; this catches refresh, tab
  // close, and hard back-button-out.
  useEffect(() => {
    if (!policyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom text and show their own copy, but
      // the return value is still required to trip the dialog.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [policyDirty]);
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    // Guard: unsaved policy edits stay put unless the admin confirms.
    // Only fires when leaving the settings tab — every other switch
    // sees the dirty flag as harmless residual state.
    if (tab === "settings" && policyDirty) {
      const ok = window.confirm(
        "You have unsaved changes on the household policy. Leave without saving?",
      );
      if (!ok) return;
      setPolicyDirty(false);
    }
    setTab(next);
    const hash =
      next === "settings"
        ? SETTINGS_HASH
        : next === "envelopes"
          ? ENVELOPES_HASH
          : next === "activity"
            ? ACTIVITY_HASH
            : next === "profile"
              ? PROFILE_HASH
              : "";
    history.replaceState(
      null,
      "",
      hash || window.location.pathname + window.location.search,
    );
  };
  const [celebration, setCelebration] = useState<
    { msg: string; kind: "ok" | "warn" } | null
  >(null);

  const [newestTxHash, setNewestTxHash] = useState<string | null>(null);
  const seenHashesRef = useRef<Set<string>>(new Set());
  // null = haven't checked localStorage yet (SSR pass + first client render).
  // The closed-Sobre guard below short-circuits to its screen only once we've
  // confirmed via useEffect that the contract is locally marked closed.
  const [closed, setClosed] = useState<boolean | null>(null);
  useEffect(() => {
    // Delayed by one paint so isSobreClosed() (which reads localStorage)
    // doesn't run during SSR. Intentional external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Give long messages more read time — the truncate-with-expand toast
    // needs a beat for the user to tap "Show more". Short toasts stay
    // snappy at the historical 2.4s.
    const dwell = msg.length > TRUNCATE_CHAR_LIMIT ? 6000 : 2400;
    setTimeout(() => setCelebration(null), dwell);
  };

  const triggerHeroAnimation = () => {
    setHeroPulse(true);
    setTimeout(() => setHeroPulse(false), 1500);
  };

  const handleDepositSuccess = (usdcDeposited: number) => {
    setDepositOpen(false);
    triggerHeroAnimation();
    flash(`+ ${usdcDeposited.toFixed(2)} USDC auto-split across envelopes`, "ok");
    refreshAll();
  };

  // ─── Closed Sobre branch ──────────────────────────────────────────────
  // localStorage flag is set by CloseWalletModal after a successful sweep.
  // The contract still allows operations technically, but the dashboard
  // refuses to render the live UI and shows a closed-state screen instead.
  if (closed) {
    return (
      <div className="sobre-app sobre-v2">
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
            <BackLink href="/dashboard" />
          </div>
        </main>
      </div>
    );
  }

  // ─── Phase 1: not signed in / wallet bootstrapping ────────────────────
  if (!address) {
    return (
      <div className="sobre-app sobre-v2">
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
        <div className="sobre-app sobre-v2">
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
              <BackLink href="/dashboard" className="mt-4" />
            </div>
          </main>
        </div>
      );
    }
    // Real error from the on-chain sim (bad contract id, missing method,
    // network flake). Surface it so the user isn't stuck on the skeleton
    // forever — with retry + a way back to the wallet list.
    if (walletState.error) {
      // Recognise the two "contract is on old wasm" flavours and show a
      // clearer message than raw simulation output. Common causes:
      //   - WasmVm InvalidAction + UnreachableCodeReached (contract panic)
      //   - MissingValue (get_state field missing from stored state)
      const needsUpgrade =
        walletState.error.includes("UnreachableCodeReached") ||
        walletState.error.includes("WasmVm, InvalidAction") ||
        walletState.error.includes("MissingValue");
      return (
        <div className="sobre-app sobre-v2">
          <TopBar wallet={wallet} />
          <main className="flex-1 grid place-items-center px-6">
            <div className="text-center max-w-md">
              <h1 className="font-serif text-[24px] font-semibold mb-3">
                {needsUpgrade
                  ? "This Sobre is on an older version"
                  : "Can't load this Sobre"}
              </h1>
              <p
                className="text-[13px] mb-5"
                style={{ color: "var(--text-2)" }}
              >
                {needsUpgrade
                  ? "The on-chain contract can't be read by the current app. The admin needs to call upgrade() to bring it to the latest wasm."
                  : walletState.error}
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  type="button"
                  onClick={refresh}
                  className="sobre-btn sobre-btn-primary"
                  style={{ padding: "10px 16px", fontSize: 13 }}
                >
                  Try again
                </button>
                <BackLink href="/dashboard" />
              </div>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="sobre-app sobre-v2 has-dock">
        <DashboardSkeleton tab={tab} />
      </div>
    );
  }

  // ─── Sub-account view ─────────────────────────────────────────────────
  // Stripped layout: no envelopes, no member list, no policy. Sub-account
  // role + admin/member role are mutually exclusive on chain, so this
  // branch fires only for kids whose wallet is in state.subaccounts.
  if (isSubaccount) {
    return (
      <div className="sobre-app sobre-v2 has-dock">
        {/* No TopBar here — matches the main wallet view. Identity + sign
            out live inside the User tab; primary Cash-out lives on the
            dock fab. */}
        <SubAccountView
          userAddress={address}
          contractId={contractId}
          state={state}
          events={txFeed.events}
          onFlash={flash}
          onChange={refreshAll}
          wallet={wallet}
        />
        {heroPulse ? <HeroPulse /> : null}
        {celebration ? (
          <Celebration message={celebration.msg} kind={celebration.kind} />
        ) : null}
      </div>
    );
  }

  // ─── Connected but not a member of THIS Sobre ─────────────────────────
  if (!isMember) {
    return (
      <div className="sobre-app sobre-v2">
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
            <BackLink href="/dashboard" />
          </div>
        </main>
      </div>
    );
  }

  // ─── Full dashboard ───────────────────────────────────────────────────
  return (
    <div className="sobre-app sobre-v2 has-dock">
      {/* Top bar removed on this route — mobile-first primary nav is the
          bottom dock; wallet name + currency toggle now live inside the
          balance hero header, and the Profile dock tab owns identity. */}

      {/* Back affordance for the settings sub-view — reached from the
          Envelopes-tab gear, so back-nav returns there. */}
      {tab === "settings" ? (
        <div
          className="mx-auto w-full px-4 sm:px-7 pt-5"
          style={{ maxWidth: 1320 }}
        >
          <BackLink onClick={() => switchTab("envelopes")} label="Envelopes" />
        </div>
      ) : null}

      {walletState.familyError ? (
        // Family settings (split %, policy) failed to load — dashboard
        // would otherwise render against DEFAULT_PERCENTS [50,30,20] and
        // an open policy, which the next deposit/spend would route by.
        // Surface the failure + force a manual refresh so we don't move
        // money under stale state.
        <div
          className="mx-auto w-full px-4 sm:px-7 pt-3"
          style={{ maxWidth: 1320 }}
        >
          <div
            className="rounded-md px-4 py-3 text-sm flex items-center gap-3"
            style={{
              background: "rgba(220,38,38,0.07)",
              color: "var(--sobre-danger)",
              border: "1px solid rgba(220,38,38,0.18)",
            }}
          >
            <span className="flex-1">{walletState.familyError}</span>
            <button
              type="button"
              onClick={refresh}
              className="sobre-btn sobre-btn-soft"
              style={{ fontSize: 12, padding: "6px 10px" }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {tab === "home" ? (
      <div
        className="mx-auto w-full px-4 sm:px-7 pt-6 pb-12"
        style={{ maxWidth: 640 }}
      >
        <Reveal as="div" data-stagger className="sobre-wallet-col">
          <CashoutApprovalBanner
            requests={pendingApprovals.requests}
            envelopeNames={state.envelope_names}
            memberDisplayFor={memberDisplayFor}
            subaccountDisplayFor={(address) => {
              const s = state.subaccounts.find((x) => x.address === address);
              if (!s) return null;
              const row = subRows.find(
                (r) => r.walletAddress === address,
              );
              return {
                name: row?.displayName ?? "a sub-account",
                avatarUrl: row?.avatarUrl ?? null,
              };
            }}
            onApprove={pendingApprovals.approve}
            onDeny={pendingApprovals.deny}
          />
          <BalanceHero
            state={state}
            header={
              <div className="hero-title-row">
                <div className="hero-title-left">
                  <span className="hero-title-name">
                    {state.wallet_name || "Family Wallet"}
                  </span>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="hero-title-edit"
                      onClick={() => setRenameOpen(true)}
                      aria-label="Rename Sobre"
                      title="Rename Sobre"
                    >
                      <PencilSimpleIcon weight="bold" size={12} />
                    </button>
                  ) : null}
                </div>
                <CurrencyToggle />
              </div>
            }
          >
            <EnvelopeSplitCard
              state={state}
              onOpen={() => switchTab("envelopes")}
            />
          </BalanceHero>

          <EarnGrowSummary
            state={state}
            onOpenEnvelopes={() => switchTab("envelopes")}
            onEarnInfo={() => setEarnInfoOpen(true)}
          />

          <RecentActivityPreview
            events={feedEvents}
            loading={txFeed.loading}
            members={state.members}
            subaccounts={subaccountRefs}
            envelopeNames={state.envelope_names}
            onSeeAll={() => switchTab("activity")}
            onExpenseDeleted={() => expenseLogHook.refresh()}
          />

        </Reveal>
      </div>
      ) : null}

      {tab === "activity" ? (
        <Reveal
          as="div"
          className="mx-auto w-full px-4 sm:px-7 pt-6 pb-12"
          style={{ maxWidth: 760 }}
        >
          <div
            style={{
              display: "flex",
              gap: 24,
              borderBottom: "1px solid var(--border)",
              marginBottom: 18,
            }}
          >
            <ActivitySegment
              label="Feed"
              active={activityView === "feed"}
              onClick={() => switchActivityView("feed")}
            />
            <ActivitySegment
              label="Expenses"
              active={activityView === "expenses"}
              onClick={() => switchActivityView("expenses")}
            />
          </div>

          <div
            key={activityView}
            className="sobre-fade-in"
          >
          {activityView === "expenses" ? (
            <ExpensesView
              events={feedEvents}
              envelopeNames={state.envelope_names}
              members={state.members}
              subaccounts={subaccountRefs}
              onExpenseDeleted={() => expenseLogHook.refresh()}
            />
          ) : (
          <ActivityFeed
            events={feedEvents}
            loading={txFeed.loading}
            error={txFeed.error}
          newestTxHash={newestTxHash}
          members={state.members}
          subaccounts={subaccountRefs}
          envelopeNames={state.envelope_names}
          pendingDeposits={activeDeposits.deposits.filter(
            (d) =>
              d.identifier !== activeDepositId &&
              !cancelledDepositIds.has(d.identifier),
          )}
          pendingCashouts={activeCashouts.cashouts.filter(
            (c) => c.identifier !== activeCashoutId,
          )}
          failedDeposits={activeDeposits.recentlyFailed}
          failedCashouts={activeCashouts.recentlyFailed}
          completedCashouts={activeCashouts.recentlyCompleted}
          onResumeCashout={(identifier) => {
            setResumeCashoutId(identifier);
            setCashoutOpen(true);
          }}
          onExpenseDeleted={() => expenseLogHook.refresh()}
          onResumeDeposit={(identifier) => {
            setResumeDepositId(identifier);
            setDepositOpen(true);
          }}
          onCancelDeposit={async (identifier) => {
            // Optimistically hide the row so the PENDING section reflects
            // the click immediately. Cleared in the finally so a row PDAX
            // resurrects (payment landed after we cancelled) reappears
            // correctly instead of being stuck-invisible from a local
            // hidden flag surviving across the resurrect.
            setCancelledDepositIds((prev) => {
              const next = new Set(prev);
              next.add(identifier);
              return next;
            });
            try {
              const res = await fetch(
                `/api/pdax/deposits/${identifier}/cancel`,
                { method: "POST" },
              );
              if (res.status === 409) {
                flash(
                  "PDAX already received your payment. Finishing your deposit.",
                  "ok",
                );
                await activeDeposits.refresh();
                return { ok: false, alreadyPaid: true };
              }
              flash("Deposit cancelled.", "warn");
              await activeDeposits.refresh();
              return { ok: true };
            } catch {
              await activeDeposits.refresh();
              return { ok: false };
            } finally {
              setCancelledDepositIds((prev) => {
                if (!prev.has(identifier)) return prev;
                const next = new Set(prev);
                next.delete(identifier);
                return next;
              });
            }
          }}
          />
          )}
          </div>
        </Reveal>
      ) : null}

      {tab === "envelopes" ? (
        <Reveal
          as="div"
          className="mx-auto w-full px-4 sm:px-7 pt-6 pb-12"
          style={{ maxWidth: 760 }}
        >
          <div className="sobre-envs">
            <header className="sobre-envs-header">
              <h2>Envelopes</h2>
              {isAdmin ? (
                <button
                  type="button"
                  className="sobre-envs-settings"
                  data-badge={proposalNeedsMyVote ? "true" : undefined}
                  onClick={() => switchTab("settings")}
                  aria-label={
                    proposalNeedsMyVote
                      ? "Sobre rules & settings (proposal awaits your vote)"
                      : "Sobre rules & settings"
                  }
                  title="Sobre rules & settings"
                >
                  <GearSixIcon weight="bold" size={18} />
                </button>
              ) : null}
            </header>

            <SplitLegendBar state={state} />

            {state.balances.map((_, i) => {
              const envName = ENVELOPE_LABELS[i];
              const earnPos = state.earn?.positions.find(
                (p) => p.envelope === envName,
              );
              const earnStrip = earnPos
                ? { interestEarnedStroops: earnPos.interestEarned }
                : undefined;
              return (
                <EnvelopeCard
                  key={i}
                  index={i}
                  balanceStroops={envelopeTotalStroops(state, i)}
                  percent={state.percents[i] ?? 0}
                  onOpen={() => setEnvActionsFor(envName)}
                  envelopeNames={state.envelope_names}
                  envelopeIcons={state.envelope_icons}
                  currency={currency}
                  earn={earnStrip}
                />
              );
            })}

            <SupplementarySummary
              rows={subRows}
              onChain={state.subaccounts}
              events={txFeed.events}
              envelopeNames={state.envelope_names}
              currency={currency}
            />

            {address ? (
              <EarnPanel
                userAddress={address}
                contractId={contractId}
                state={state}
                isAdmin={isAdmin}
                onFlash={flash}
                onChange={refreshAll}
              />
            ) : null}

            {address ? (
              <GrowPanel
                userAddress={address}
                contractId={contractId}
                state={state}
                isAdmin={isAdmin}
                onFlash={flash}
                onChange={refreshAll}
                onEarnInfo={() => setEarnInfoOpen(true)}
              />
            ) : null}
          </div>
        </Reveal>
      ) : null}

      {tab === "profile" ? (
        <Reveal
          as="div"
          className="mx-auto w-full px-4 sm:px-7 pb-12 pt-6 space-y-5"
          style={{ maxWidth: 480 }}
        >
          <ProfileSheet wallet={wallet} />
          <BankAccountSection />
          <MembersSection
            members={state.members}
            adminAddresses={state.admins}
            adminCount={state.admin_count}
            adminCap={state.admin_cap}
            familyWalletId={familyWalletId}
            canInvite={isAdmin && state.members.length < state.admin_cap}
            canEditCap={isAdmin}
            onInvite={() => setInviteOpen(true)}
            onCapChanged={({ cancelledHints }) => {
              void walletState.refreshDisplay();
              if (cancelledHints > 0) {
                flash(
                  `Cap lowered. Cancelled ${cancelledHints} pending admin invite${cancelledHints === 1 ? "" : "s"}.`,
                  "warn",
                );
              } else {
                flash("Admin cap updated", "ok");
              }
            }}
          />
          <SubAccountsPanel
            userAddress={address}
            contractId={contractId}
            familyWalletId={familyWalletId}
            memberWalletDbId={wallet.wallet?.id ?? null}
            rows={subRows}
            state={state}
            events={txFeed.events}
            isAdmin={isAdmin}
            onFlash={flash}
            onChange={refreshAll}
          />
        </Reveal>
      ) : null}

      {tab === "settings" ? (
      <Reveal
        as="section"
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
            <h3>Envelope names &amp; icons</h3>
            <EnvelopeNamesForm
              userAddress={address}
              familyWalletId={familyWalletId}
              isAdmin={isAdmin}
              current={state.envelope_names}
              currentIcons={state.envelope_icons}
              onSuccess={() => {
                refresh();
                flash("Envelope changes saved", "ok");
              }}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Envelope split</h3>
            {splitProposals.pending ? (
              <SplitProposalCard
                proposal={splitProposals.pending}
                currentPercents={[
                  state.percents[0] ?? 0,
                  state.percents[1] ?? 0,
                  state.percents[2] ?? 0,
                ]}
                currentWalletId={wallet.wallet?.id ?? null}
                envelopeNames={state.envelope_names}
                adminCount={state.admin_count}
                onResolved={(kind) => {
                  void splitProposals.refresh();
                  refresh();
                  if (kind === "approved") flash("Split applied to next deposit", "ok");
                  else if (kind === "rejected") flash("Proposal rejected", "warn");
                  else if (kind === "cancelled") flash("Proposal cancelled", "warn");
                }}
              />
            ) : null}
            <EnvelopeSplitForm
              userAddress={address}
              familyWalletId={familyWalletId}
              isAdmin={isAdmin}
              current={state.percents}
              envelopeNames={state.envelope_names}
              adminCount={state.admin_count}
              hasPendingProposal={Boolean(splitProposals.pending)}
              onSuccess={() => {
                refresh();
                flash("Split saved", "ok");
              }}
              onProposalSent={() => {
                void splitProposals.refresh();
                flash("Proposal sent to the other admin", "ok");
              }}
            />
          </div>

          <div className="sobre-admin-section sobre-card-flat">
            <h3>Household policy</h3>
            <PolicySettingsForm
              familyWalletId={familyWalletId}
              isAdmin={isAdmin}
              adminCount={state.admins.length}
              current={state.policy}
              envelopeNames={state.envelope_names}
              onDirtyChange={setPolicyDirty}
              onSuccess={() => {
                setPolicyDirty(false);
                refresh();
                flash("Policy saved", "ok");
              }}
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
                <WarningIcon weight="fill" size={14} />
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
      </Reveal>
      ) : null}

      <BottomDock
        active={dockActive(tab)}
        onTab={(next) => switchTab(next as Tab)}
        onOpenSobre={() => setSobreSheetOpen(true)}
      />

      {sobreSheetOpen ? (
        <OpenSobreSheet
          onClose={() => setSobreSheetOpen(false)}
          onAddMoney={() => setDepositOpen(true)}
          onLogExpense={() => setLogExpenseOpen(true)}
          onCashOut={() => {
            setCashoutInitialEnvelope(undefined);
            setCashoutOpen(true);
          }}
          onSend={() => setSendToSubOpen(true)}
          disableSend={!isAdmin || state.balances.every((b) => b === 0n)}
        />
      ) : null}

      {heroPulse ? <HeroPulse /> : null}
      {celebration ? (
        <Celebration message={celebration.msg} kind={celebration.kind} />
      ) : null}

      {depositOpen ? (
        <PdaxDepositModal
          state={state}
          contractId={contractId}
          resumeIdentifier={resumeDepositId ?? undefined}
          onActiveIdentifierChange={setActiveDepositId}
          onClose={() => {
            setDepositOpen(false);
            setResumeDepositId(null);
            void activeDeposits.refresh();
          }}
          onAttemptCancel={async (identifier) => {
            // Run /cancel, flash the right toast, and report
            // alreadyPaid back to the modal. The modal decides
            // whether to close (200) or stay open (409). Keeping
            // the modal open in the 409 path avoids the misleading
            // "Awaiting payment · tap to resume" entry in the
            // activity feed for a row that's already paid — the
            // user instead watches their deposit advance.
            let alreadyPaid = false;
            if (identifier) {
              try {
                const res = await fetch(
                  `/api/pdax/deposits/${identifier}/cancel`,
                  { method: "POST" },
                );
                if (res.status === 409) alreadyPaid = true;
              } catch {
                // best effort; the TTL sweep will catch it eventually
                return { ok: false };
              }
            }
            flash(
              alreadyPaid
                ? "PDAX already received your payment. Finishing your deposit."
                : "Deposit cancelled.",
              alreadyPaid ? "ok" : "warn",
            );
            if (alreadyPaid && identifier) {
              // Fire-and-forget kick so the row advances from
              // pending → funded server-side promptly, even if the
              // user closes the tab. The modal's own poll-status
              // loop is still firing in parallel; this is the
              // belt-and-suspenders kick for the case where the
              // user closes the modal right after the 409.
              void fetch(
                `/api/pdax/deposits/${identifier}/poll-status`,
              ).catch(() => {});
            } else if (identifier) {
              // 200 OK cancel path: PDAX's /fiat/transactions reporting
              // can lag the actual settlement, so the cancel went
              // through even though the user really did pay. Schedule
              // re-refreshes — the active route's resurrect pass scans
              // recently-cancelled rows and re-checks PDAX, resurrecting
              // any that PDAX has since marked COMPLETED. Two delays
              // (5s + 15s) catch PDAX's typical reporting lag; the 30s
              // tick is covered by useActiveDeposits' own heartbeat.
              for (const delay of [5_000, 15_000]) {
                setTimeout(() => void activeDeposits.refresh(), delay);
              }
            }
            await activeDeposits.refresh();
            return { ok: true, alreadyPaid };
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
          familyWalletId={familyWalletId}
          memberWalletDbId={wallet.wallet?.id ?? null}
          resumeIdentifier={resumeCashoutId ?? undefined}
          onActiveIdentifierChange={setActiveCashoutId}
          initialEnvelope={cashoutInitialEnvelope}
          onClose={() => {
            // Modal closes while the row may still be transferred /
            // converted / processing. The activity feed picks it up and
            // tracks it through to `paid`, at which point the toast
            // below fires from the auto-driver path.
            setCashoutOpen(false);
            setResumeCashoutId(null);
            void activeCashouts.refresh();
          }}
          onSuccess={({ php }) => {
            // Only fires when the row hit `paid`, which now means
            // PDAX confirmed bank settlement (webhook) OR the
            // post-processing grace period elapsed without a failure.
            setResumeCashoutId(null);
            flash(
              `₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2 })} landed in your bank`,
              "ok",
            );
            refreshAll();
          }}
        />
      ) : null}

      {envActionsFor ? (
        <EnvelopeActionsSheet
          envelope={envActionsFor}
          envelopeIndex={ENVELOPE_LABELS.indexOf(envActionsFor)}
          balanceStroops={envelopeTotalStroops(
            state,
            ENVELOPE_LABELS.indexOf(envActionsFor),
          )}
          envelopeNames={state.envelope_names}
          envelopeIcons={state.envelope_icons}
          isAdmin={isAdmin}
          onClose={() => setEnvActionsFor(null)}
          onCashOut={() => {
            setCashoutInitialEnvelope(envActionsFor);
            setEnvActionsFor(null);
            setCashoutOpen(true);
          }}
          onSendToSub={() => {
            setSendToSubFor(envActionsFor);
            setEnvActionsFor(null);
          }}
          onTransfer={() => {
            setTransferForEnvelope(envActionsFor);
            setEnvActionsFor(null);
          }}
        />
      ) : null}

      {transferForEnvelope ? (
        <TransferBetweenEnvelopesModal
          userAddress={address}
          contractId={contractId}
          state={state}
          familyWalletId={familyWalletId}
          memberWalletDbId={wallet.wallet?.id ?? null}
          initialEnvelope={transferForEnvelope}
          onClose={() => setTransferForEnvelope(null)}
          onSuccess={() => {
            setTransferForEnvelope(null);
            refreshAll();
          }}
          onFlash={flash}
        />
      ) : null}

      {sendToSubFor || sendToSubOpen ? (
        <FundSubAccountModal
          userAddress={address}
          contractId={contractId}
          state={state}
          familyWalletId={familyWalletId}
          memberWalletDbId={wallet.wallet?.id ?? null}
          subRows={subRows}
          initialEnvelope={sendToSubFor ?? undefined}
          onClose={() => {
            setSendToSubFor(null);
            setSendToSubOpen(false);
          }}
          onSuccess={() => {
            setSendToSubFor(null);
            setSendToSubOpen(false);
            refreshAll();
          }}
          onFlash={flash}
        />
      ) : null}

      {inviteOpen ? (
        <InviteModal
          walletName={state.wallet_name}
          adminAddress={address}
          contractId={contractId}
          familyWalletId={familyWalletId}
          createdByWalletId={wallet.wallet?.id ?? null}
          adminCount={state.admin_count}
          adminCap={state.admin_cap}
          suggestions={inviteSuggestions}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}

      {earnInfoOpen ? (
        <EarnInfoModal onClose={() => setEarnInfoOpen(false)} />
      ) : null}

      {renameOpen ? (
        <RenameWalletModal
          currentName={state.wallet_name}
          adminAddress={address}
          contractId={contractId}
          onClose={() => setRenameOpen(false)}
          onRenamed={() => {
            refresh();
            flash("Wallet name saved", "ok");
          }}
        />
      ) : null}

      {logExpenseOpen ? (
        <Sheet
          onClose={() => setLogExpenseOpen(false)}
          ariaLabel="Log an expense"
        >
          <h2>Log an expense</h2>
          <ExpenseQuickAdd
            familyWalletId={familyWalletId}
            onSaved={(log) => {
              setLogExpenseOpen(false);
              expenseLogHook.refresh();
              const label = log.vendor ?? log.note.slice(0, 40);
              flash(`Saved ${label}`, "ok");
            }}
          />
        </Sheet>
      ) : null}

      {closeOpen ? (
        <CloseWalletModal
          adminAddress={address}
          state={state}
          contractId={contractId}
          onClose={() => setCloseOpen(false)}
          onSuccess={() => {
            setCloseOpen(false);
            flash("Wallet closed. Funds swept back to your address.", "ok");
            setClosed(true);
            refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}
