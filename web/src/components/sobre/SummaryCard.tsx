"use client";

import { Copy, Plus, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import type { WalletState } from "@/hooks/useWalletState";
import { PHP_PER_XLM, STROOPS_PER_XLM } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

const MEMBER_COLORS = [
  { bg: "#fbe7d2", fg: "#D67E28" }, // mango — first member (admin)
  { bg: "#E8F0EA", fg: "#2E6B4C" }, // green — second member
] as const;

export function SummaryCard({
  state,
  address,
  onDeposit,
  dailySpent,
}: {
  state: WalletState;
  address: string;
  onDeposit: () => void;
  /** Sum of stroops the connected user has spent today (UTC). Computed from
   *  the activity feed by the dashboard. Used to render "remaining today". */
  dailySpent: bigint;
}) {
  const totalStroops = state.balances.reduce((acc, b) => acc + b, 0n);
  const totalXlm = Number(totalStroops) / STROOPS_PER_XLM;
  const totalPhp = totalXlm * PHP_PER_XLM;
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
          <span className="tabular">{totalXlm.toFixed(4)} XLM</span>
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

        <DailyLimitCard
          dailyLimit={state.policy.daily_limit}
          dailySpent={dailySpent}
        />

        <div className="sobre-members">
          <span className="sobre-label">
            Members ({state.members.length}/2)
          </span>
          <div className="mt-3 space-y-1">
            {state.members.map((m, i) => {
              const palette = MEMBER_COLORS[i % MEMBER_COLORS.length];
              const isAdmin = m === state.admin;
              const isYou = m === address;
              const initials = m.slice(1, 3).toUpperCase();
              return (
                <div key={m} className="sobre-member">
                  <div
                    className="av"
                    style={{ background: palette.bg, color: palette.fg }}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="name">
                      {shortenAddress(m)}
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
                      {isAdmin ? "Admin · OFW" : "Family member"}
                    </div>
                  </div>
                  <button
                    onClick={() => void copyAddr(m)}
                    className="sobre-iconbtn"
                    style={{ width: 28, height: 28 }}
                    title={
                      copiedAddr === m ? "Copied!" : "Copy full address"
                    }
                  >
                    <Copy size={13} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
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

  const limitXlm = Number(dailyLimit) / STROOPS_PER_XLM;
  const limitPhp = limitXlm * PHP_PER_XLM;
  const spentXlm = Number(dailySpent) / STROOPS_PER_XLM;
  const remainingStroops =
    dailySpent >= dailyLimit ? 0n : dailyLimit - dailySpent;
  const remainingXlm = Number(remainingStroops) / STROOPS_PER_XLM;
  const remainingPhp = remainingXlm * PHP_PER_XLM;

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

  return (
    <div
      className="mt-5 pt-4 border-t"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="sobre-label">Daily limit</span>
      <div className="mt-2 flex items-baseline justify-between">
        <div
          className="tabular"
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--text-1)",
          }}
        >
          ₱{" "}
          {remainingPhp.toLocaleString("en-PH", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
          left of ₱{" "}
          {limitPhp.toLocaleString("en-PH", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}
        </div>
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
      <div
        className="mt-2 flex items-center justify-between text-[11px]"
        style={{ color: "var(--text-2)" }}
      >
        <span className="tabular">
          Spent today: ₱{" "}
          {(spentXlm * PHP_PER_XLM).toLocaleString("en-PH", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer size={11} strokeWidth={2} />
          Refreshes in {hours}h {minutes}m
        </span>
      </div>
    </div>
  );
}
