"use client";

import { useApproveRequest } from "@/hooks/useApproveRequest";
import { useDenyRequest } from "@/hooks/useDenyRequest";
import type { PendingRequest } from "@/hooks/useWalletState";
import { formatXlm, shortenAddress } from "@/lib/format";

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
      <p className="text-xs text-muted-foreground">No pending requests.</p>
    );
  }

  const inFlight = approveInFlight || denyInFlight;
  const showError = approveError ?? denyError;

  const handleApprove = async (id: bigint) => {
    try {
      await approve(id);
      onSuccess();
    } catch {
      // error already on hook
    }
  };
  const handleDeny = async (id: bigint) => {
    try {
      await deny(id);
      onSuccess();
    } catch {
      // error already on hook
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-2">
        {pending.map((req) => (
          <li
            key={req.id.toString()}
            className="rounded border p-2 space-y-1"
          >
            <div>
              <span className="font-mono text-xs text-muted-foreground">
                #{req.id.toString()}
              </span>{" "}
              {shortenAddress(req.caller)} wants {formatXlm(req.amount)} from{" "}
              <strong>{req.envelope}</strong>
              {req.memo ? ` — "${req.memo}"` : ""}
            </div>
            {isAdmin ? (
              <div className="flex gap-2">
                <button
                  onClick={() => void handleApprove(req.id)}
                  disabled={inFlight}
                  className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
                >
                  {approveInFlight ? "Approving…" : "Approve"}
                </button>
                <button
                  onClick={() => void handleDeny(req.id)}
                  disabled={inFlight}
                  className="rounded bg-destructive/80 px-2 py-0.5 text-xs text-destructive-foreground disabled:opacity-50"
                >
                  {denyInFlight ? "Denying…" : "Deny"}
                </button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Waiting for admin approval.
              </div>
            )}
          </li>
        ))}
      </ul>
      {showError ? (
        <p className="text-xs text-destructive break-all">{showError}</p>
      ) : null}
    </div>
  );
}
