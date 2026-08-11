"use client";

import { ArrowDownToLine, ArrowLeftRight, Send } from "lucide-react";

import {
  PHP_PER_USDC,
  RAMPS_AVAILABLE,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { renderEnvelopeIcon } from "@/lib/envelopeIcons";

import { Sheet } from "./Sheet";

interface Props {
  envelope: EnvelopeName;
  envelopeIndex: number;
  balanceStroops: bigint;
  envelopeNames: string[];
  envelopeIcons?: string[];
  isAdmin: boolean;
  onClose: () => void;
  onCashOut: () => void;
  onSendToSub: () => void;
  /** Kicks off the inter-Sobre transfer flow with this envelope
   *  pre-selected as the source. Admin-only. */
  onTransfer: () => void;
}

/**
 * Bottom sheet that opens when the user taps an envelope card. Presents
 * the two real actions an OFW family cares about:
 *
 *  1. **Cash out** — pull money out of the envelope. With the PDAX
 *     ramps live that means pesos into the registered InstaPay account;
 *     with RAMPS_AVAILABLE off it means USDC to a wallet address.
 *
 *  2. **Send to family member** — top up a supplementary account's
 *     spendable balance from this envelope. Admin-only (members
 *     don't see the button).
 *
 * The old "Spend" button — which just transferred USDC to the user's own
 * smart wallet address — is gone. It made sense when the target audience
 * was crypto-native, but OFW families don't distinguish "my wallet" from
 * "my Sobre".
 */
export function EnvelopeActionsSheet({
  envelope,
  envelopeIndex,
  balanceStroops,
  envelopeNames,
  envelopeIcons,
  isAdmin,
  onClose,
  onCashOut,
  onSendToSub,
  onTransfer,
}: Props) {
  const displayName = displayEnvelopeName(envelope, envelopeNames);
  const iconKey = envelopeIcons?.[envelopeIndex];
  const balancePhp =
    (Number(balanceStroops) / STROOPS_PER_USDC) * PHP_PER_USDC;
  const isEmpty = balanceStroops === 0n;

  return (
    <Sheet onClose={onClose} ariaLabel={`${displayName} actions`}>
      <div className="flex items-center gap-3 mb-1">
        <div
          className="grid place-items-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "var(--surface-alt)",
            color: "var(--text-1)",
          }}
        >
          {renderEnvelopeIcon(iconKey, envelope, 20)}
        </div>
        <div>
          <h2 style={{ margin: 0 }}>{displayName}</h2>
          <div
            className="sub tabular"
            style={{ margin: 0, fontSize: 13 }}
          >
            ₱
            {balancePhp.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
      </div>

      {isEmpty ? (
        <p className="sub" style={{ marginTop: 10 }}>
          Nothing in this envelope yet. Add money from the home tab first.
        </p>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 8,
          marginTop: 16,
          marginBottom: 8,
        }}
      >
        <ActionRow
          icon={<ArrowDownToLine size={20} strokeWidth={2} />}
          title={RAMPS_AVAILABLE ? "Cash out to bank" : "Cash out"}
          subtitle={
            RAMPS_AVAILABLE
              ? "Send pesos to your InstaPay bank account"
              : "Withdraw to a crypto wallet"
          }
          disabled={isEmpty}
          onClick={onCashOut}
        />
        {isAdmin ? (
          <ActionRow
            icon={<Send size={20} strokeWidth={2} />}
            title="Send to family member"
            subtitle="Top up a supplementary account"
            disabled={isEmpty}
            onClick={onSendToSub}
          />
        ) : null}
        {isAdmin ? (
          <ActionRow
            icon={<ArrowLeftRight size={20} strokeWidth={2} />}
            title="Move to another envelope"
            subtitle="Shift money between envelopes inside this Sobre"
            disabled={isEmpty}
            onClick={onTransfer}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 p-3 rounded-[12px] text-left w-full"
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface-alt)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        className="grid place-items-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--accent-soft)",
          color: "var(--sobre-accent)",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1 }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}
