"use client";

import { useMemo, useState } from "react";
import { CaretRightIcon, LockIcon } from "@phosphor-icons/react";

import type { FeedEvent } from "@/hooks/useTxFeed";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import type { SubAccount } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";
import { Avatar } from "@/components/sobre/Avatar";
import { SupplementaryDetailModal } from "@/components/sobre/SupplementaryDetailModal";

/**
 * Envelope-tab card for each ACTIVE supplementary — an envelope-style row
 * (avatar · name · balance · chevron) that opens a detail sheet with the
 * recent activity for that supplementary. Pending invites are omitted;
 * management (invite, send, lock) lives on the User tab.
 */
export function SupplementarySummary({
  rows,
  onChain,
  events,
  envelopeNames,
  currency = "PHP",
}: {
  rows: FamilySubaccountRow[];
  onChain: SubAccount[];
  events: FeedEvent[];
  envelopeNames: string[];
  currency?: "PHP" | "USD";
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  // The parent re-renders every ~3s off the tx-feed poll; without memo
  // this .filter + Map rebuild runs each tick even when neither list moved.
  const { active, byAddress } = useMemo(() => {
    const filtered = rows.filter(
      (r) => !r.invitePending && r.walletAddress,
    );
    const map = new Map(onChain.map((s) => [s.address, s] as const));
    return { active: filtered, byAddress: map };
  }, [rows, onChain]);
  if (active.length === 0) return null;

  const openRow = active.find((r) => r.id === openId) ?? null;
  const openChain = openRow
    ? (byAddress.get(openRow.walletAddress!) ?? null)
    : null;

  return (
    <section className="sobre-envs-section" aria-label="Supplementary">
      <div className="sobre-envs-section-head">
        <h3>Supplementary</h3>
      </div>
      {active.map((row) => (
        <SupplementaryRow
          key={row.id}
          row={row}
          chain={byAddress.get(row.walletAddress!) ?? null}
          currency={currency}
          onOpen={() => setOpenId(row.id)}
        />
      ))}
      {openRow ? (
        <SupplementaryDetailModal
          row={openRow}
          chain={openChain}
          events={events}
          envelopeNames={envelopeNames}
          currency={currency}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </section>
  );
}

function SupplementaryRow({
  row,
  chain,
  currency,
  onOpen,
}: {
  row: FamilySubaccountRow;
  chain: SubAccount | null;
  currency: "PHP" | "USD";
  onOpen: () => void;
}) {
  const balance = chain?.balance ?? 0n;
  const usd = Number(balance) / STROOPS_PER_USDC;
  const showUsd = currency === "USD";
  const value = showUsd ? usd : usd * PHP_PER_USDC;
  const symbol = showUsd ? "$" : "₱";
  const isLocked = chain?.locked ?? false;
  return (
    <button type="button" onClick={onOpen} className="sobre-env-row-btn">
      <span className="ic" style={{ background: "transparent", padding: 0 }}>
        <Avatar src={null} name={row.displayName} size={40} />
      </span>
      <span className="body">
        <span className="name">{row.displayName}</span>
        <span className="sub">
          <span className="pct">Supplementary</span>
          {isLocked ? (
            <>
              <span className="dot" aria-hidden />
              <LockIcon
                weight="fill"
                size={10}
                aria-label="Locked"
              />
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
