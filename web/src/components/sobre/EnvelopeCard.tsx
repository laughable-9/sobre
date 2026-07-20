"use client";

import { CaretRightIcon } from "@phosphor-icons/react";

import {
  ENVELOPE_LABELS,
  STROOPS_PER_USDC,
  displayEnvelopeName,
} from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";
import { renderEnvelopeIcon } from "@/lib/envelopeIcons";
import { formatInterestCurrencyLocale } from "@/lib/format";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

/**
 * One-row envelope entry on the Envelopes tab: icon · name · amount ·
 * chevron. Tapping opens the envelope action sheet (Cash out / Send to
 * family member); the action sheet owns whichever downstream modal fires.
 *
 * `earn` — optional yield context. Balance passed in already includes
 * any USDY underlying so the number the user sees is unified; the row
 * also shows lifetime interest earned once it's non-zero.
 */
export function EnvelopeCard({
  index,
  balanceStroops,
  percent,
  onOpen,
  envelopeNames,
  envelopeIcons,
  currency = "PHP",
  earn,
  dataTour,
}: {
  index: number;
  balanceStroops: bigint;
  percent: number;
  onOpen: () => void;
  envelopeNames: string[];
  /** Per-envelope icon keys — see lib/envelopeIcons. Falls back to slot
   *  defaults for missing/unknown keys. */
  envelopeIcons?: string[];
  /** Display currency for the balance. */
  currency?: "PHP" | "USD";
  earn?: {
    interestEarnedStroops: bigint;
  };
  /** Optional data-tour anchor id, set on the outer wrap so the
   *  dashboard tour can spotlight a specific card. */
  dataTour?: string;
}) {
  const slot = ENVELOPE_LABELS[index];
  const name = displayEnvelopeName(slot, envelopeNames);
  const iconKey = envelopeIcons?.[index];
  const usd = Number(balanceStroops) / STROOPS_PER_USDC;
  const php = usd * PHP_PER_USDC;
  const showUsd = currency === "USD";
  const value = showUsd ? usd : php;
  const symbol = showUsd ? "$" : "₱";

  return (
    <div className="sobre-env-row-wrap" data-tour={dataTour}>
      <button type="button" onClick={onOpen} className="sobre-env-row-btn">
        <span className="ic">{renderEnvelopeIcon(iconKey, slot, 18)}</span>
        <span className="body">
          <span className="name">{name}</span>
          <span className="sub">
            <span className="pct">{percent}%</span>
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
      {earn && earn.interestEarnedStroops > 0n ? (
        <div className="sobre-env-earn-strip">
          <span className="sobre-env-earn-interest">
            Interest earned{" "}
            <span className="tabular">
              {formatInterestCurrencyLocale(earn.interestEarnedStroops, currency)}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
