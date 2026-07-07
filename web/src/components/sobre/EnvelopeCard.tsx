"use client";

import {
  GraduationCap,
  Lock,
  Plant,
  ShoppingCart,
  TrendUp,
} from "@phosphor-icons/react";

import type { FeedEvent } from "@/hooks/useTxFeed";
import type { Member } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { formatPhpLocale, relativeTime, shortenAddress } from "@/lib/format";
import { PHP_PER_USDC } from "@/lib/config";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

const ICON_BY_NAME: Record<EnvelopeName, React.ReactNode> = {
  Groceries: <ShoppingCart weight="fill" size={20} />,
  Tuition: <GraduationCap weight="fill" size={20} />,
  Savings: <Plant weight="fill" size={20} />,
};

export function EnvelopeCard({
  index,
  balanceStroops,
  percent,
  pulsing,
  onSpend,
  approvalRequired,
  events,
  members,
  envelopeNames,
  currency = "PHP",
}: {
  index: number;
  balanceStroops: bigint;
  percent: number;
  pulsing: boolean;
  onSpend: () => void;
  /** True when require_all_sigs is on OR this envelope is in protected_envelopes. */
  approvalRequired: boolean;
  /** Activity feed used to derive "spent this month" + "last activity". */
  events: FeedEvent[];
  /** Used to render the actor's name on the last-activity blurb. */
  members: Member[];
  envelopeNames: string[];
  /** Display currency for the balance. PHP is home currency; USD is the
   *  option. The other currency shows as a smaller sub-line. */
  currency?: "PHP" | "USD";
}) {
  const slot = ENVELOPE_LABELS[index];
  const name = displayEnvelopeName(slot, envelopeNames);
  const usd = Number(balanceStroops) / STROOPS_PER_USDC;
  const php = usd * PHP_PER_USDC;
  const isSavings = slot === "Savings";
  const isEmpty = balanceStroops === 0n;
  const showUsd = currency === "USD";

  const { spentThisMonthStroops, lastActivity } = useEnvelopeStats(
    events,
    slot,
    members,
  );

  return (
    <div
      className={[
        "sobre-envelope",
        isSavings ? "green-env" : "",
        pulsing ? "pulse" : "",
        isEmpty ? "empty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="row1">
        <div className="ic">{ICON_BY_NAME[slot]}</div>
        <h3>{name}</h3>
        <div className="meta-right">
          {approvalRequired ? (
            <span
              className="sobre-pill"
              style={{
                background: "var(--sobre-cream)",
                color: "var(--sobre-warning)",
              }}
              title="Spends from this envelope need admin approval"
            >
              <Lock weight="fill" size={11} />
              Approval required
            </span>
          ) : null}
          {isSavings ? (
            <span className="sobre-pill sobre-pill-soft-green">
              <TrendUp weight="fill" size={12} />
              4.5% APY
            </span>
          ) : null}
          <span className="sobre-pill sobre-pill-cream">{percent}% split</span>
        </div>
      </div>

      <div className="sobre-env-amount">
        <AnimatedNumber
          value={showUsd ? usd : php}
          format={(n) => {
            const whole = Math.floor(n).toLocaleString("en-PH");
            const cents = Math.abs(n).toFixed(2).split(".")[1];
            return (
              <>
                {showUsd ? "$" : "₱"} {whole}
                <span style={{ fontSize: 24, color: "var(--text-2)" }}>
                  .{cents}
                </span>
              </>
            );
          }}
        />
      </div>

      {/* Secondary line: the currency you're NOT viewing, for reference. */}
      <div className="sobre-env-usdc tabular">
        {showUsd
          ? `≈ ₱ ${php.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          : `≈ $ ${usd.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
      </div>

      <div className="sobre-env-meta">
        <div className="sobre-env-row">
          <span style={{ color: "var(--text-2)" }}>Spent this month</span>
          <b className="tabular" style={{ color: "var(--text-1)" }}>
            {formatPhpLocale(spentThisMonthStroops)}
          </b>
        </div>
        <div className="sobre-env-row last">
          <span style={{ color: "var(--text-3)" }}>
            {lastActivity ?? "No activity yet"}
          </span>
        </div>
      </div>

      <div
        className="sobre-env-foot"
        style={{ marginTop: 14, justifyContent: "flex-end" }}
      >
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={onSpend}
          disabled={isEmpty}
          style={isEmpty ? { opacity: 0.5, cursor: "not-allowed" } : {}}
        >
          Spend
        </button>
      </div>
    </div>
  );
}

function useEnvelopeStats(
  events: FeedEvent[],
  envelope: EnvelopeName,
  members: Member[],
): { spentThisMonthStroops: bigint; lastActivity: string | null } {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;

  let spent = 0n;
  let last: FeedEvent | null = null;
  for (const ev of events) {
    if (ev.kind !== "Spend" || ev.envelope !== envelope) continue;
    const d = new Date(ev.ledgerClosedAt);
    if (`${d.getUTCFullYear()}-${d.getUTCMonth()}` === monthKey) {
      spent += ev.amount;
    }
    if (!last) last = ev;
  }

  if (!last) {
    return { spentThisMonthStroops: spent, lastActivity: null };
  }

  const profile = members.find((m) => m.address === last!.caller);
  const who = profile
    ? profile.emoji
      ? `${profile.emoji} ${profile.name}`
      : profile.name
    : shortenAddress(last.caller);
  const phpFmt = formatPhpLocale(last.amount);
  const when = relativeTime(last.ledgerClosedAt);
  const lastActivity = `Last: ${who} spent ${phpFmt} · ${when}`;

  return { spentThisMonthStroops: spent, lastActivity };
}
