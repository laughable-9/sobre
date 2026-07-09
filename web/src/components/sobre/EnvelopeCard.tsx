"use client";

import {
  CaretRightIcon,
  GraduationCapIcon,
  LockIcon,
  PlantIcon,
  ShoppingCartIcon,
} from "@phosphor-icons/react";

import {
  ENVELOPE_LABELS,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

const ICON_BY_NAME: Record<EnvelopeName, React.ReactNode> = {
  Groceries: <ShoppingCartIcon weight="fill" size={18} />,
  Tuition: <GraduationCapIcon weight="fill" size={18} />,
  Savings: <PlantIcon weight="fill" size={18} />,
};

/**
 * One-row envelope entry on the Envelopes tab: icon · name · amount ·
 * chevron. Tapping opens SpendModal (or the empty-envelope explanation).
 * Detail (spend history, approval policy specifics) lives inside that
 * modal, not on this list.
 */
export function EnvelopeCard({
  index,
  balanceStroops,
  percent,
  onSpend,
  approvalRequired,
  envelopeNames,
  currency = "PHP",
}: {
  index: number;
  balanceStroops: bigint;
  percent: number;
  onSpend: () => void;
  /** True when require_all_sigs is on OR this envelope is in protected_envelopes. */
  approvalRequired: boolean;
  envelopeNames: string[];
  /** Display currency for the balance. */
  currency?: "PHP" | "USD";
}) {
  const slot = ENVELOPE_LABELS[index];
  const name = displayEnvelopeName(slot, envelopeNames);
  const usd = Number(balanceStroops) / STROOPS_PER_USDC;
  const php = usd * PHP_PER_USDC;
  const showUsd = currency === "USD";
  const value = showUsd ? usd : php;
  const symbol = showUsd ? "$" : "₱";

  return (
    <button type="button" onClick={onSpend} className="sobre-env-row-btn">
      <span className="ic">{ICON_BY_NAME[slot]}</span>
      <span className="body">
        <span className="name">{name}</span>
        <span className="sub">
          {percent}% split
          {approvalRequired ? (
            <>
              <span className="dot" aria-hidden />
              <LockIcon weight="fill" size={11} />
              Approval
            </>
          ) : null}
        </span>
      </span>
      <span className="amount tabular">
        <AnimatedNumber
          value={value}
          format={(n) => {
            const whole = Math.floor(n).toLocaleString("en-PH");
            const cents = Math.abs(n).toFixed(2).split(".")[1];
            return (
              <>
                {symbol}
                {whole}
                <span className="cents">.{cents}</span>
              </>
            );
          }}
        />
      </span>
      <CaretRightIcon
        weight="bold"
        size={14}
        className="chev"
        aria-hidden
      />
    </button>
  );
}
