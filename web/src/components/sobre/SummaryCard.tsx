"use client";

import {
  ArrowDownToLine,
  Check,
  Copy,
  Plus,
  Timer,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { WalletState } from "@/hooks/useWalletState";
import { STROOPS_PER_USDC } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { PHP_PER_USDC } from "@/lib/config";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

const MEMBER_PALETTES = [
  { bg: "#fbe7d2", fg: "#D67E28" }, // mango — first slot (admin)
  { bg: "#E8F0EA", fg: "#2E6B4C" }, // green — second slot
] as const;

export function SummaryCard({
  state,
  address,
  onDeposit,
  onCashout,
  dailySpent,
  onKick,
  onInvite,
  children,
}: {
  state: WalletState;
  address: string;
  onDeposit: () => void;
  /** Opens the cashout modal. Rendered as a secondary action under
   *  "Add a remittance". Any member can initiate; policy gates apply
   *  on the spend() leg the modal triggers. */
  onCashout: () => void;
  /** Sum of stroops the connected user has spent today (UTC). Computed from
   *  the activity feed by the dashboard. Used to render "remaining today". */
  dailySpent: bigint;
  /** Admin-only; omit for non-admin viewers. Wired by the dashboard to open
   *  a confirm-then-removeMember flow. */
  onKick?: (memberAddress: string) => void;
  /** Admin-only; opens the InviteModal. Rendered as a slot in the members
   *  list when there's still room (members < 2). */
  onInvite?: () => void;
  /** Optional extra cards stacked below the total-balance card in the same
   *  left column — used by the dashboard to surface pending approvals. */
  children?: React.ReactNode;
}) {
  const isAdmin = address === state.admin;
  const canInvite = isAdmin && state.members.length < 2;
  const totalStroops = state.balances.reduce((acc, b) => acc + b, 0n);
  const totalUsdc = Number(totalStroops) / STROOPS_PER_USDC;
  const totalPhp = totalUsdc * PHP_PER_USDC;
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const copyAddr = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(addr);
      setTimeout(() => setCopiedAddr(null), 1200);
    } catch {
      // clipboard refused; ignore
    }
  };

  return (
    <aside className="sobre-summary">
      <div className="sobre-summary-card">
        <span className="sobre-label">Total balance</span>
        <div className="sobre-total">
          <AnimatedNumber
            value={totalPhp}
            format={(n) => {
              const whole = Math.floor(n).toLocaleString("en-PH");
              const cents = Math.abs(n).toFixed(2).split(".")[1];
              return (
                <>
                  ₱ {whole}
                  <span className="cents">.{cents}</span>
                </>
              );
            }}
          />
        </div>
        <div
          className="flex items-center gap-2 mt-3 text-[13px]"
          style={{ color: "var(--text-2)" }}
        >
          <span className="tabular">{totalUsdc.toFixed(4)} USDC</span>
          <span
            className="w-[3px] h-[3px] rounded-full"
            style={{ background: "var(--text-3)" }}
          />
          <span>{state.balances.length} envelopes</span>
        </div>

        <button
          type="button"
          onClick={onDeposit}
          className="sobre-btn sobre-btn-primary mt-4 w-full justify-center"
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          <Plus size={16} strokeWidth={2} />
          Add a remittance
        </button>

        <button
          type="button"
          onClick={onCashout}
          disabled={totalStroops === 0n}
          className="sobre-btn sobre-btn-soft mt-2 w-full justify-center"
          style={{
            padding: "12px 18px",
            fontSize: 14,
            opacity: totalStroops === 0n ? 0.5 : 1,
            cursor: totalStroops === 0n ? "not-allowed" : "pointer",
          }}
        >
          <ArrowDownToLine size={16} strokeWidth={2} />
          Cash out to bank
        </button>

        <DailyLimitCard
          dailyLimit={state.policy.daily_limit}
          dailySpent={dailySpent}
        />

        <div className="sobre-members">
          <div className="flex items-center justify-between">
            <span className="sobre-label">
              Members ({state.members.length}/2)
            </span>
            {canInvite && onInvite ? (
              <button
                type="button"
                onClick={onInvite}
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--sobre-primary)" }}
              >
                <UserPlus size={11} strokeWidth={2.5} />
                Invite
              </button>
            ) : null}
          </div>
          <div className="mt-3 space-y-1">
            {state.members.map((m, i) => {
              const palette = MEMBER_PALETTES[i % MEMBER_PALETTES.length];
              const memberIsAdmin = m.address === state.admin;
              const isYou = m.address === address;
              return (
                <div key={m.address} className="sobre-member">
                  <div
                    className="av"
                    style={{
                      background: palette.bg,
                      color: palette.fg,
                      fontSize: m.emoji ? 18 : 12,
                    }}
                    title={m.address}
                  >
                    {m.emoji || m.address.slice(1, 3).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="name">
                      {m.name || shortenAddress(m.address)}
                      {isYou ? (
                        <span
                          className="ml-2 text-[11px]"
                          style={{ color: "var(--sobre-accent)" }}
                        >
                          you
                        </span>
                      ) : null}
                    </div>
                    <div className="role">
                      {memberIsAdmin ? "Admin" : "Family member"}
                    </div>
                  </div>
                  <button
                    onClick={() => void copyAddr(m.address)}
                    className="sobre-iconbtn"
                    style={{
                      width: 28,
                      height: 28,
                      color:
                        copiedAddr === m.address
                          ? "var(--sobre-accent)"
                          : undefined,
                    }}
                    title={
                      copiedAddr === m.address
                        ? "Copied!"
                        : "Copy full address"
                    }
                  >
                    {copiedAddr === m.address ? (
                      <Check size={13} strokeWidth={2.5} />
                    ) : (
                      <Copy size={13} strokeWidth={2} />
                    )}
                  </button>
                  {isAdmin && !memberIsAdmin && onKick ? (
                    <button
                      onClick={() => onKick(m.address)}
                      className="sobre-iconbtn"
                      style={{
                        width: 28,
                        height: 28,
                        color: "var(--sobre-danger)",
                      }}
                      title="Remove member"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {children}
    </aside>
  );
}

/**
 * The contract resets each member's daily spend counter at UTC midnight
 * (storage key includes `timestamp / 86400`). Mirror that here: tick once a
 * minute so the "refreshes in" countdown stays roughly accurate without
 * burning CPU on a per-second update.
 */
function DailyLimitCard({
  dailyLimit,
  dailySpent,
}: {
  dailyLimit: bigint | null;
  dailySpent: bigint;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (dailyLimit === null) {
    return (
      <div
        className="mt-5 pt-4 border-t text-[13px]"
        style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
      >
        <div className="flex items-center gap-2">
          <Timer size={14} strokeWidth={2} style={{ color: "var(--text-3)" }} />
          <span>No daily spend limit set</span>
        </div>
      </div>
    );
  }

  const limitXlm = Number(dailyLimit) / STROOPS_PER_USDC;
  const limitPhp = limitXlm * PHP_PER_USDC;
  const remainingStroops =
    dailySpent >= dailyLimit ? 0n : dailyLimit - dailySpent;
  const remainingXlm = Number(remainingStroops) / STROOPS_PER_USDC;
  const remainingPhp = remainingXlm * PHP_PER_USDC;

  // % of limit used today, for the progress fill.
  const usedFrac =
    dailyLimit === 0n
      ? 0
      : Math.min(1, Number(dailySpent) / Number(dailyLimit));
  const usedPct = usedFrac * 100;

  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    ),
  );
  const diffMs = tomorrow.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);

  const limitLabel = limitPhp.toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const remainingLabel = remainingPhp.toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return (
    <div
      className="mt-5 pt-4 border-t"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-baseline justify-between">
        <span className="sobre-label">Daily limit</span>
        <span
          className="text-[11px] tabular inline-flex items-center gap-1 whitespace-nowrap"
          style={{ color: "var(--text-3)" }}
        >
          <Timer size={11} strokeWidth={2} />
          Resets in {hours}h {minutes}m
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span
          className="tabular whitespace-nowrap"
          style={{
            fontFamily: "var(--serif)",
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text-1)",
          }}
        >
          ₱{remainingLabel}
        </span>
        <span
          className="text-[11px] tabular whitespace-nowrap"
          style={{ color: "var(--text-3)" }}
        >
          left of ₱{limitLabel}
        </span>
      </div>
      <div
        className="mt-2 h-[6px] rounded-full overflow-hidden"
        style={{ background: "var(--surface-alt)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${usedPct}%`,
            background:
              usedFrac >= 1
                ? "var(--sobre-danger)"
                : usedFrac >= 0.8
                  ? "var(--sobre-warning)"
                  : "var(--sobre-accent)",
            transition: "width .6s ease",
          }}
        />
      </div>
    </div>
  );
}
