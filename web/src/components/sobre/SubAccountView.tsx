"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import {
  ArrowSquareOutIcon,
  HouseIcon,
  UserIcon,
} from "@phosphor-icons/react";

import { useActiveSubaccountCashouts } from "@/hooks/useActiveSubaccountCashouts";
import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { SubAccount, WalletState } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { formatShortDateTime } from "@/lib/format";
import { subaccountActivity } from "@/lib/sobre/subaccountActivity";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { MembersSection } from "./MembersSection";
import { ProfileSheet } from "./ProfileSheet";
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

  // Always open the modal — the modal itself renders a friendly empty
  // state when the balance is zero or the account is locked, so the fab
  // never feels dead.
  const onCashOutTap = () => setCashoutOpen(true);

  return (
    <>
      {tab === "home" ? (
        <div
          className="mx-auto w-full px-4 sm:px-7 pt-7 pb-12"
          style={{ maxWidth: 460 }}
        >
          <section
            className="sobre-v2 sobre-v2-hero"
            aria-label="Spendable balance"
          >
            <div className="hero-title-row">
              <div className="hero-title-left">
                <span className="hero-title-name">
                  {state.wallet_name || "Sobre family"}
                </span>
              </div>
            </div>
            <div className="label">Spendable balance</div>
            <div className="amount">
              ₱
              {Math.floor(balancePhp).toLocaleString("en-PH")}
              <span className="cents">
                .{Math.abs(balancePhp).toFixed(2).split(".")[1]}
              </span>
            </div>
          </section>

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
        <div
          className="mx-auto w-full px-4 sm:px-7 pt-7 pb-12 space-y-5"
          style={{ maxWidth: 460 }}
        >
          <ProfileSheet wallet={wallet} />
          <MembersSection
            members={state.members}
            adminAddress={state.admin}
            adminCount={state.admin_count}
            adminCap={state.admin_cap}
            familyWalletId={null}
            canInvite={false}
            canEditCap={false}
          />
        </div>
      ) : null}

      <SubAccountDock
        active={tab}
        onTab={setTab}
        onCashOut={onCashOutTap}
      />

      {cashoutOpen && myRow ? (
        <SubAccountCashoutModal
          userAddress={userAddress}
          contractId={contractId}
          subaccountId={myRow.id}
          balanceStroops={balanceStroops}
          locked={locked}
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

/** Sub-account dock: mirrors the main wallet's 5-slot dock but with only
 *  Home + Cash-out fab + User. Uses the same .sobre-dock chrome so both
 *  shells look identical. */
function SubAccountDock({
  active,
  onTab,
  onCashOut,
}: {
  active: SubTab;
  onTab: (tab: SubTab) => void;
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
          className="sobre-dock-fab"
          aria-label="Cash out"
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
