"use client";

import { useState } from "react";
import { Check, Lock, X } from "lucide-react";

import type {
  PendingCashoutRequest,
} from "@/hooks/usePendingCashoutApprovals";
import { Avatar } from "@/components/sobre/Avatar";
import { STROOPS_PER_TOKEN, displayEnvelopeName } from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";

/** Renders every pending cashout request awaiting the current admin's
 *  sign-off. One row per request; Approve and Deny buttons operate
 *  against the row's family_pending_requests id. When approval
 *  completes the admin set, the row flips server-side to `approved`
 *  and the initiator's modal picks up the state and auto-continues.
 */
export function CashoutApprovalBanner({
  requests,
  envelopeNames,
  memberDisplayFor,
  subaccountDisplayFor,
  onApprove,
  onDeny,
}: {
  requests: PendingCashoutRequest[];
  envelopeNames: string[];
  memberDisplayFor: (walletDbId: string) => {
    name: string;
    avatarUrl: string | null;
  };
  /** Lookup for sub-account recipients by on-chain address. Used
   *  on subaccount_fund rows to render "send ₱X to <kid>". */
  subaccountDisplayFor?: (address: string) => {
    name: string;
    avatarUrl: string | null;
  } | null;
  onApprove: (row: PendingCashoutRequest) => Promise<void>;
  onDeny: (row: PendingCashoutRequest) => Promise<void>;
}) {
  if (requests.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mb-4">
      {requests.map((r) => (
        <ApprovalRow
          key={r.id}
          request={r}
          envelopeNames={envelopeNames}
          memberDisplay={memberDisplayFor(r.memberWalletId)}
          recipientDisplay={
            r.kind === "subaccount_fund" && r.recipientAddress
              ? subaccountDisplayFor?.(r.recipientAddress) ?? null
              : null
          }
          onApprove={() => onApprove(r)}
          onDeny={() => onDeny(r)}
        />
      ))}
    </div>
  );
}

function ApprovalRow({
  request,
  envelopeNames,
  memberDisplay,
  recipientDisplay,
  onApprove,
  onDeny,
}: {
  request: PendingCashoutRequest;
  envelopeNames: string[];
  memberDisplay: { name: string; avatarUrl: string | null };
  recipientDisplay: { name: string; avatarUrl: string | null } | null;
  onApprove: () => Promise<void>;
  onDeny: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const usdc = Number(request.amountStroops) / STROOPS_PER_TOKEN;
  const php = usdc * PHP_PER_USDC;
  const envelopeLabel = displayEnvelopeName(request.envelope, envelopeNames);

  const handleApprove = async () => {
    setBusy("approve");
    try {
      await onApprove();
    } finally {
      setBusy(null);
    }
  };
  const handleDeny = async () => {
    setBusy("deny");
    try {
      await onDeny();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="sobre-card-flat"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderColor: "#e8b9b0",
        background: "#fffaf3",
      }}
    >
      <div
        className="grid place-items-center shrink-0"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--sobre-danger-soft)",
          color: "var(--sobre-danger)",
        }}
        aria-hidden
      >
        <Lock size={16} strokeWidth={2.4} />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-2 text-[14px]"
          style={{ color: "var(--text-1)", fontWeight: 600 }}
        >
          <span className="inline-flex items-center gap-1.5 shrink-0">
            <Avatar
              name={memberDisplay.name}
              src={memberDisplay.avatarUrl}
              size={22}
            />
            {memberDisplay.name}
          </span>
          <span
            className="truncate"
            style={{ fontWeight: 500, color: "var(--text-2)" }}
          >
            {(() => {
              const amt = `₱${Math.round(php).toLocaleString("en-PH")}`;
              if (request.kind === "subaccount_fund") {
                return `wants to send ${amt} to ${recipientDisplay?.name ?? "a sub-account"} from ${envelopeLabel}`;
              }
              if (request.kind === "transfer") {
                // recipient_address on transfer rows is "envelope:<Name>"
                // — surface the destination envelope name so the copy
                // reads naturally.
                const destRaw = request.recipientAddress ?? "";
                const destKey = destRaw.startsWith("envelope:")
                  ? destRaw.slice("envelope:".length)
                  : "";
                const destLabel =
                  destKey === "Groceries" || destKey === "Tuition" || destKey === "Savings"
                    ? envelopeNames[
                        destKey === "Groceries" ? 0 : destKey === "Tuition" ? 1 : 2
                      ] ?? destKey
                    : "another envelope";
                return `wants to move ${amt} from ${envelopeLabel} to ${destLabel}`;
              }
              return `wants to cash out ${amt} from ${envelopeLabel}`;
            })()}
          </span>
        </div>
        <div
          className="mt-1 text-[11px]"
          style={{ color: "var(--text-3)" }}
        >
          Needs your approval before it can go through.
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void handleDeny()}
          disabled={busy !== null}
          aria-label="Deny cashout request"
          className="grid place-items-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-2)",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          <X size={16} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={busy !== null}
          className="sobre-btn sobre-btn-primary"
          style={{
            padding: "8px 14px",
            fontSize: 13,
            opacity: busy ? 0.7 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          <Check size={14} strokeWidth={2.4} />
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
