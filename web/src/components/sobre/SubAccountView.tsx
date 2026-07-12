"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Lock } from "lucide-react";
import {
  ArrowSquareOutIcon,
  HouseIcon,
  SignOutIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

import { useActiveSubaccountCashouts } from "@/hooks/useActiveSubaccountCashouts";
import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { SubAccount, WalletState } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { formatShortDateTime, shortenAddress } from "@/lib/format";
import { subaccountActivity } from "@/lib/sobre/subaccountActivity";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { Avatar } from "./Avatar";
import { SubAccountCashoutModal } from "./SubAccountCashoutModal";

interface Props {
  userAddress: string;
  contractId: string;
  state: WalletState;
  events: FeedEvent[];
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
  onChange: () => void;
  /** Wallet connection carrying the Google OAuth session — used to sign
   *  out from the User tab. */
  wallet: WalletConnectionState;
  /** Google display name from the OAuth session. Preferred over the DB
   *  row's display_name because pre-migration rows had the admin-picked
   *  name frozen at invite time; the Google name is always the joiner's
   *  actual identity. */
  preferredDisplayName?: string | null;
}

type SubTab = "home" | "user";

/**
 * Stripped dashboard for a sub-account holder. Mirrors the main wallet's
 * shell: bottom dock with a center Cash-out fab and Home / User tabs.
 * Home carries the balance + activity in one column so the kid never
 * needs to switch tabs to see "how much do I have and where did it go".
 */
export function SubAccountView({
  userAddress,
  contractId,
  state,
  events,
  onFlash,
  onChange,
  wallet,
  preferredDisplayName,
}: Props) {
  const [tab, setTab] = useState<SubTab>("home");

  const mySelf: SubAccount | null = useMemo(
    () => state.subaccounts.find((s) => s.address === userAddress) ?? null,
    [state.subaccounts, userAddress],
  );

  const myRow = useOwnSubaccountRow();

  const { active: pendingCashouts } = useActiveSubaccountCashouts(
    myRow?.walletDbId ?? null,
  );

  const [cashoutOpen, setCashoutOpen] = useState(false);
  const [resumeCashoutId, setResumeCashoutId] = useState<string | null>(null);

  const balanceStroops = mySelf?.balance ?? 0n;
  const balancePhp =
    (Number(balanceStroops) / STROOPS_PER_USDC) * PHP_PER_USDC;
  const locked = mySelf?.locked ?? false;

  const history = useMemo(
    () => subaccountActivity(events, userAddress, state.envelope_names),
    [events, userAddress, state.envelope_names],
  );

  const displayName =
    preferredDisplayName ?? myRow?.displayName ?? "Allowance";
  const avatarUrl = wallet.wallet?.avatar_url ?? null;
  const email = wallet.user?.email ?? "";

  const canCashOut = !locked && balanceStroops > 0n;

  return (
    <>
      {tab === "home" ? (
        <div
          className="mx-auto w-full px-4 sm:px-7 pt-7 pb-12"
          style={{ maxWidth: 460 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar src={avatarUrl} name={displayName} size={56} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.1,
                }}
              >
                {displayName}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-2)",
                  marginTop: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{state.wallet_name || "Sobre family"}</span>
                {locked ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--sobre-danger)",
                      background: "#fbe9e6",
                      padding: "2px 7px",
                      borderRadius: 999,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    <Lock size={9} strokeWidth={2.6} />
                    Locked
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 28, textAlign: "left" }}>
            <div
              className="tabular"
              style={{
                fontSize: 52,
                fontWeight: 600,
                letterSpacing: "-0.025em",
                lineHeight: 1,
                color: locked ? "var(--text-3)" : "var(--text-1)",
              }}
            >
              ₱
              {balancePhp.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-3)",
                marginTop: 6,
              }}
            >
              Spendable balance
            </div>
          </div>

          <section style={{ marginTop: 28 }}>
            <h2
              style={{
                fontFamily: "var(--serif)",
                fontSize: 16,
                fontWeight: 600,
                margin: "0 0 10px",
                letterSpacing: "-0.01em",
              }}
            >
              Activity
            </h2>

            {pendingCashouts.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                    marginBottom: 6,
                  }}
                >
                  Pending
                </div>
                {pendingCashouts.map((c) => (
                  <button
                    key={c.identifier}
                    type="button"
                    onClick={() => {
                      setResumeCashoutId(c.identifier);
                      setCashoutOpen(true);
                    }}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      marginBottom: 8,
                      background: "var(--accent-soft)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "var(--surface)",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--sobre-accent)",
                        flexShrink: 0,
                      }}
                    >
                      <Clock size={16} strokeWidth={2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        Pending cashout ₱
                        {(c.amount_php ?? 0).toLocaleString("en-PH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-2)",
                          marginTop: 2,
                        }}
                      >
                        {labelForStatus(c.status)} · tap to resume
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
              }}
            >
              {history.length === 0 ? (
                <div
                  style={{
                    padding: "16px 14px",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  No activity yet.
                </div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={`${h.txHash}:${i}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "12px 14px",
                      borderBottom:
                        i === history.length - 1
                          ? "none"
                          : "1px solid var(--border)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {h.label}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-3)",
                          marginTop: 2,
                        }}
                      >
                        {formatShortDateTime(h.whenIso)}
                      </div>
                    </div>
                    <div
                      className="tabular"
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color:
                          h.direction === "in"
                            ? "var(--sobre-accent)"
                            : "var(--text-1)",
                      }}
                    >
                      {h.direction === "in" ? "+" : "-"}₱
                      {h.php.toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "user" ? (
        <SubAccountProfile
          displayName={displayName}
          email={email}
          avatarUrl={avatarUrl}
          address={userAddress}
          walletName={state.wallet_name}
          wallet={wallet}
        />
      ) : null}

      <SubAccountDock
        active={tab}
        onTab={setTab}
        canCashOut={canCashOut}
        onCashOut={() => setCashoutOpen(true)}
      />

      {cashoutOpen && myRow ? (
        <SubAccountCashoutModal
          userAddress={userAddress}
          contractId={contractId}
          subaccountId={myRow.id}
          balanceStroops={balanceStroops}
          resumeIdentifier={resumeCashoutId ?? undefined}
          onClose={() => {
            setCashoutOpen(false);
            setResumeCashoutId(null);
          }}
          onSuccess={(php) => {
            onFlash(
              `Cashed out ₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
            );
            onChange();
          }}
        />
      ) : null}
    </>
  );
}

function SubAccountProfile({
  displayName,
  email,
  avatarUrl,
  address,
  walletName,
  wallet,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  address: string;
  walletName: string;
  wallet: WalletConnectionState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await wallet.disconnect();
    } finally {
      router.replace("/");
    }
  };

  return (
    <section
      className="mx-auto w-full px-4 sm:px-7 pt-7 pb-12"
      aria-label="User"
      style={{ maxWidth: 460 }}
    >
      <div className="sobre-profile">
        <div className="head">
          <Avatar src={avatarUrl} name={displayName} size={72} />
          <div className="who">
            <div className="name">{displayName}</div>
            {email ? <div className="email">{email}</div> : null}
          </div>
        </div>

        <dl className="sobre-profile-meta">
          <div>
            <dt>Family</dt>
            <dd>{walletName || "Sobre family"}</dd>
          </div>
          <div>
            <dt>Your wallet</dt>
            <dd className="tabular">{shortenAddress(address)}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
          className="sobre-btn sobre-btn-soft w-full justify-center"
          style={{
            padding: "14px 22px",
            fontSize: 15,
            marginTop: 18,
            opacity: busy ? 0.55 : 1,
          }}
        >
          <SignOutIcon weight="bold" size={16} />
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </section>
  );
}

/** Sub-account dock: mirrors the main wallet's 5-slot dock but with only
 *  Home + Cash-out fab + User. Uses the same .sobre-dock chrome so both
 *  shells look identical. */
function SubAccountDock({
  active,
  onTab,
  canCashOut,
  onCashOut,
}: {
  active: SubTab;
  onTab: (tab: SubTab) => void;
  canCashOut: boolean;
  onCashOut: () => void;
}) {
  return (
    <nav className="sobre-dock" aria-label="Primary">
      <div className="sobre-dock-inner" data-cols="3">
        <button
          type="button"
          onClick={() => onTab("home")}
          className="sobre-dock-tab"
          data-active={active === "home"}
          aria-current={active === "home" ? "page" : undefined}
        >
          <HouseIcon size={22} weight={active === "home" ? "fill" : "regular"} />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={onCashOut}
          disabled={!canCashOut}
          className="sobre-dock-fab"
          aria-label="Cash out"
          style={{ opacity: canCashOut ? 1 : 0.5 }}
        >
          <ArrowSquareOutIcon weight="fill" size={26} />
        </button>

        <button
          type="button"
          onClick={() => onTab("user")}
          className="sobre-dock-tab"
          data-active={active === "user"}
          aria-current={active === "user" ? "page" : undefined}
        >
          <UserIcon size={22} weight={active === "user" ? "fill" : "regular"} />
          <span>User</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * Fetch this sub-account holder's own row. RLS scopes SELECT to the row
 * keyed to the auth user, so a plain `from('family_subaccounts').select()`
 * returns exactly one row.
 */
function useOwnSubaccountRow(): FamilySubaccountRow | null {
  const [row, setRow] = useState<FamilySubaccountRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    void supabase
      .from("family_subaccounts")
      .select(
        "id, family_wallet_id, wallet_id, wallet_address, display_name, invite_token_hash, created_at",
      )
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const r = data as {
          id: string;
          family_wallet_id: string;
          wallet_id: string | null;
          wallet_address: string | null;
          display_name: string;
          invite_token_hash: string | null;
          created_at: string;
        };
        setRow({
          id: r.id,
          familyWalletId: r.family_wallet_id,
          walletDbId: r.wallet_id,
          walletAddress: r.wallet_address,
          displayName: r.display_name,
          invitePending: r.wallet_id === null,
          inviteTokenHash: r.invite_token_hash,
          createdAt: r.created_at,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return row;
}

function labelForStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Waiting on PDAX";
    case "confirmed":
      return "Confirmed";
    case "paid":
      return "Paid";
    default:
      return status;
  }
}
