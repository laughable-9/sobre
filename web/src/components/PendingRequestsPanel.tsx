"use client";

import { Check, Hourglass, X } from "lucide-react";

import { useApproveRequest } from "@/hooks/useApproveRequest";
import { useDenyRequest } from "@/hooks/useDenyRequest";
import type { PendingRequest } from "@/hooks/useWalletState";
import { formatPhpLocale, shortenAddress } from "@/lib/format";

export function PendingRequestsPanel({
  userAddress,
  isAdmin,
  pending,
  onSuccess,
}: {
  userAddress: string | null;
  isAdmin: boolean;
  pending: PendingRequest[];
  onSuccess: () => void;
}) {
  const {
    approve,
    pending: approveInFlight,
    error: approveError,
  } = useApproveRequest(userAddress);
  const {
    deny,
    pending: denyInFlight,
    error: denyError,
  } = useDenyRequest(userAddress);

  if (!userAddress) return null;

  if (pending.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-3)" }}>
        Walang pending. Spends below the policy threshold execute immediately.
      </p>
    );
  }

  const inFlight = approveInFlight || denyInFlight;
  const showError = approveError ?? denyError;

  const handleApprove = async (id: bigint) => {
    try {
      await approve(id);
      onSuccess();
    } catch {
      // surfaces below
    }
  };
  const handleDeny = async (id: bigint) => {
    try {
      await deny(id);
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
            key={req.id.toString()}
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
            <div className="flex-1 min-w-0">
              <div className="text-[14px]">
                <span
                  className="font-mono text-[12px]"
                  style={{ color: "var(--text-3)" }}
                >
                  #{req.id.toString()}
                </span>{" "}
                <span style={{ color: "var(--text-1)" }}>
                  {shortenAddress(req.caller)} wants{" "}
                  <b className="tabular">{formatPhpLocale(req.amount)}</b>{" "}
                  from <b>{req.envelope}</b>
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
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void handleApprove(req.id)}
                    disabled={inFlight}
                    className="sobre-btn"
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
                    onClick={() => void handleDeny(req.id)}
                    disabled={inFlight}
                    className="sobre-btn sobre-btn-soft"
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
