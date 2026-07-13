"use client";

import { useMemo } from "react";
import { LockIcon } from "@phosphor-icons/react";

import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { SubAccount } from "@/hooks/useWalletState";
import { Avatar } from "@/components/sobre/Avatar";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { formatShortDateTime } from "@/lib/format";
import { subaccountActivity } from "@/lib/sobre/subaccountActivity";

import { Sheet } from "./Sheet";

/**
 * Read-only detail sheet for one active supplementary. Reached by tapping
 * their row in the Envelopes tab. Shows avatar, name, current balance,
 * lock chip, and their recent activity. All admin actions (send, lock,
 * invite) live in the User tab so this sheet stays focused on "what did
 * they spend and how much do they have."
 */
export function SupplementaryDetailModal({
  row,
  chain,
  events,
  envelopeNames,
  currency,
  onClose,
}: {
  row: FamilySubaccountRow;
  chain: SubAccount | null;
  events: FeedEvent[];
  envelopeNames: string[];
  currency: "PHP" | "USD";
  onClose: () => void;
}) {
  const isLocked = chain?.locked ?? false;
  const balance = chain?.balance ?? 0n;
  const usd = Number(balance) / STROOPS_PER_USDC;
  const value = currency === "USD" ? usd : usd * PHP_PER_USDC;
  const symbol = currency === "USD" ? "$" : "₱";

  const history = useMemo(
    () =>
      subaccountActivity(events, row.walletAddress, envelopeNames, {
        limit: 20,
      }),
    [events, row.walletAddress, envelopeNames],
  );

  return (
    <Sheet onClose={onClose} ariaLabel={`${row.displayName} activity`}>
      <div className="sobre-supp-detail-head">
        <Avatar src={null} name={row.displayName} size={56} />
        <div className="who">
          <div className="name">
            {row.displayName}
            {isLocked ? (
              <span className="lock-chip" aria-label="Locked">
                <LockIcon weight="fill" size={10} />
                Locked
              </span>
            ) : null}
          </div>
          <div className="balance tabular">
            {symbol}
            {value.toLocaleString(currency === "USD" ? "en-US" : "en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="label">Spendable balance</div>
        </div>
      </div>

      <div className="sobre-supp-detail-history">
        <div className="head">Recent activity</div>
        {history.length === 0 ? (
          <div className="empty">No activity yet.</div>
        ) : (
          history.map((h, i) => {
            const value = currency === "USD" ? h.php / PHP_PER_USDC : h.php;
            const symbol = currency === "USD" ? "$" : "₱";
            return (
              <div key={`${h.txHash}:${i}`} className="row">
                <div className="who">
                  <div className="label">{h.label}</div>
                  <div className="when">{formatShortDateTime(h.whenIso)}</div>
                </div>
                <div
                  className="amount tabular"
                  data-direction={h.direction}
                >
                  {h.direction === "in" ? "+" : "-"}
                  {symbol}
                  {value.toLocaleString(
                    currency === "USD" ? "en-US" : "en-PH",
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
