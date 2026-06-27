"use client";

import { useMemo } from "react";
import { Check, Hourglass, X } from "lucide-react";

import { useApproveRequest } from "@/hooks/useApproveRequest";
import { useDenyRequest } from "@/hooks/useDenyRequest";
import type { PendingSpendRequest } from "@/hooks/usePendingSpendRequests";
import type { Member } from "@/hooks/useWalletState";
import { displayEnvelopeName } from "@/lib/config";
import { formatPhpLocale, shortenAddress } from "@/lib/format";

export function PendingRequestsPanel({
  userAddress,
  contractId,
  isAdmin,
  pending,
  members,
  envelopeNames,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
  isAdmin: boolean;
  pending: PendingSpendRequest[];
  members: Member[];
  envelopeNames: string[];
  onSuccess: () => void;
}) {
  const labelForCaller = useMemo(() => {
    const byAddress = new Map<string, Member>();
    for (const m of members) byAddress.set(m.address, m);
    return (addr: string): string => {
      const m = byAddress.get(addr);
      if (!m) return shortenAddress(addr);
      return m.emoji ? `${m.emoji} ${m.name}` : m.name || shortenAddress(addr);
    };
  }, [members]);

  // Admin's Supabase wallet id is already on the merged member list — pull it
  // here once instead of re-querying inside every approve/deny.
  const adminWalletDbId =
    members.find((m) => m.address === userAddress)?.walletDbId ?? null;

  const {
    approve,
    pending: approveInFlight,
    error: approveError,
  } = useApproveRequest(userAddress, contractId, adminWalletDbId);
  const {
    deny,
    pending: denyInFlight,
    error: denyError,
  } = useDenyRequest(userAddress, adminWalletDbId);

  if (!userAddress) return null;
  if (pending.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-3)" }}>
        No pending requests. Spends below the limits go through right away.
      </p>
    );
  }

  const inFlight = approveInFlight || denyInFlight;
  const showError = approveError ?? denyError;

  const handleApprove = async (req: PendingSpendRequest) => {
    try {
      await approve(req);
      onSuccess();
    } catch {
      // surfaces below
    }
  };
  const handleDeny = async (req: PendingSpendRequest) => {
    try {
      await deny(req);
      onSuccess();
    } catch {
      // surfaces below
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-3">
        {pending.map((req) => (
          <li
            key={req.id}
            className="rounded-[10px] border p-3.5 flex items-start gap-3"
            style={{
              background: "var(--surface-alt)",
              borderColor: "var(--border)",
            }}
          >
            <div
              className="grid place-items-center shrink-0"
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: "#fdf3d8",
                color: "#b88b1c",
              }}
            >
              <Hourglass size={14} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 sobre-pending-request">
              <div className="text-[14px]">
                <span style={{ color: "var(--text-1)" }}>
                  <b>{labelForCaller(req.memberAddress)}</b> wants{" "}
                  <b className="tabular">{formatPhpLocale(req.amountStroops)}</b>{" "}
                  from{" "}
                  <b>{displayEnvelopeName(req.envelope, envelopeNames)}</b>
                </span>
              </div>
              {req.memo ? (
                <div
                  className="text-[12px] mt-1"
                  style={{ color: "var(--text-2)" }}
                >
                  &quot;{req.memo}&quot;
                </div>
              ) : null}
              {isAdmin ? (
                <div className="sobre-pending-actions">
                  <button
                    onClick={() => void handleApprove(req)}
                    disabled={inFlight}
                    className="sobre-btn justify-center"
                    style={{
                      background: "var(--sobre-accent)",
                      color: "#fff",
                      opacity: inFlight ? 0.5 : 1,
                    }}
                  >
                    <Check size={13} strokeWidth={2.5} />
                    {approveInFlight ? "Approving…" : "Approve"}
                  </button>
                  <button
                    onClick={() => void handleDeny(req)}
                    disabled={inFlight}
                    className="sobre-btn sobre-btn-soft justify-center"
                    style={{ opacity: inFlight ? 0.5 : 1 }}
                  >
                    <X size={13} strokeWidth={2.5} />
                    {denyInFlight ? "Denying…" : "Deny"}
                  </button>
                </div>
              ) : (
                <div
                  className="text-[11px] mt-2"
                  style={{ color: "var(--text-3)" }}
                >
                  Waiting for admin to decide.
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {showError ? (
        <p
          className="text-xs break-all"
          style={{ color: "var(--sobre-danger)" }}
        >
          {showError}
        </p>
      ) : null}
    </div>
  );
}
