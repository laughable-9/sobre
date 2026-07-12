"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Clock, Lock } from "lucide-react";

import { useActiveSubaccountCashouts } from "@/hooks/useActiveSubaccountCashouts";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { SubAccount, WalletState } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
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
}

/**
 * Stripped dashboard for a sub-account holder. No envelopes, no member list,
 * no policy. The kid sees their spendable balance + an Active/Locked badge,
 * a single "Cash out" CTA, and their own in/out history.
 */
export function SubAccountView({
  userAddress,
  contractId,
  state,
  events,
  onFlash,
  onChange,
}: Props) {
  const mySelf: SubAccount | null = useMemo(
    () => state.subaccounts.find((s) => s.address === userAddress) ?? null,
    [state.subaccounts, userAddress],
  );

  const myRow = useOwnSubaccountRow();

  // Pending cashouts (sub-side): mirrors the family activity feed's
  // PENDING bucket. Tap a row to resume the modal mid-pipeline (e.g. after
  // a refresh, or after the confirmed-route once 503'd).
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

  return (
    <div
      className="mx-auto w-full px-4 sm:px-7 pt-7 pb-12"
      style={{ maxWidth: 460 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar src={null} name={myRow?.displayName ?? "Allowance"} size={56} />
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
            {myRow?.displayName ?? "Allowance"}
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

      <div
        style={{
          marginTop: 28,
          textAlign: "left",
        }}
      >
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

        <button
          type="button"
          disabled={locked || balanceStroops <= 0n}
          onClick={() => setCashoutOpen(true)}
          className="sobre-btn sobre-btn-primary"
          style={{
            width: "100%",
            justifyContent: "center",
            padding: "14px 16px",
            fontSize: 15,
            fontWeight: 600,
            marginTop: 22,
            opacity: locked || balanceStroops <= 0n ? 0.45 : 1,
            cursor:
              locked || balanceStroops <= 0n ? "not-allowed" : "pointer",
          }}
        >
          <ArrowUpRight size={16} strokeWidth={2.4} />
          Cash out
        </button>
      </div>

      <section style={{ marginTop: 32 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{h.label}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      marginTop: 2,
                    }}
                  >
                    {formatRel(h.whenIso)}
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
            // Modal stays open until user dismisses success screen; we flash
            // a toast on the dashboard chrome the moment 'paid' lands.
            onFlash(
              `Cashed out ₱${php.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
            );
            onChange();
          }}
        />
      ) : null}
    </div>
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

function formatRel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function labelForStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Awaiting your confirmation";
    case "spent":
      return "Sending to PDAX";
    case "transferred":
      return "Selling for pesos";
    case "converted":
      return "Sending to your bank";
    case "processing":
      return "Waiting on your bank";
    default:
      return "In progress";
  }
}
