"use client";

import { useCallback, useMemo } from "react";
import { Check, Hourglass, X } from "lucide-react";

import { useApproveRequest } from "@/hooks/useApproveRequest";
import { useDenyRequest } from "@/hooks/useDenyRequest";
import type { PendingSpendRequest } from "@/hooks/usePendingSpendRequests";
import type { Member, SubAccount } from "@/hooks/useWalletState";
import { displayEnvelopeName } from "@/lib/config";
import { formatPhpLocale, shortenAddress } from "@/lib/format";

export function PendingRequestsPanel({
  userAddress,
  contractId,
  isAdmin,
  pending,
  members,
  subaccounts,
  adminCount,
  envelopeNames,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
  isAdmin: boolean;
  pending: PendingSpendRequest[];
  members: Member[];
  subaccounts: SubAccount[];
  /** Live admin count from useWalletState. Single source of truth. */
  adminCount: number;
  envelopeNames: string[];
  onSuccess: () => void;
}) {
  // Address → member map built once per members array. Used by the caller
  // label AND (cheap-lookup) by the admin-walletDbId resolution below.
  const memberByAddress = useMemo(() => {
    const m = new Map<string, Member>();
    for (const member of members) m.set(member.address, member);
    return m;
  }, [members]);

  const labelForCaller = useCallback(
    (addr: string): string => {
      const m = memberByAddress.get(addr);
      if (!m) return shortenAddress(addr);
      return m.emoji ? `${m.emoji} ${m.name}` : m.name || shortenAddress(addr);
    },
    [memberByAddress],
  );

  const adminWalletDbId = userAddress
    ? (memberByAddress.get(userAddress)?.walletDbId ?? null)
    : null;

  // Cross-reference the row's approvers (Supabase wallet UUIDs) with the
  // family's admin set so the count we show is "admins who've approved /
  // total admins". Non-admin originators don't inflate the numerator.
  const adminWalletIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of members) {
      if (m.role === "admin" && m.walletDbId) ids.add(m.walletDbId);
    }
    return ids;
  }, [members]);
  const subAddressSet = useMemo(
    () => new Set(subaccounts.map((s) => s.address)),
    [subaccounts],
  );

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
        {pending.map((req) => {
          const adminApprovers = req.approversWalletIds.filter((wid) =>
            adminWalletIds.has(wid),
          ).length;
          const callerAlreadyApproved =
            adminWalletDbId !== null &&
            req.approversWalletIds.includes(adminWalletDbId);
          // "Release" only makes sense when THIS admin's click is the
          // deciding vote. For all_admins rows that means their click
          // would push admin-approvers >= adminCount.
          const callerIsAdmin =
            adminWalletDbId !== null && adminWalletIds.has(adminWalletDbId);
          const adminApproversAfterClick =
            adminApprovers + (callerIsAdmin && !callerAlreadyApproved ? 1 : 0);
          const threshold =
            req.approvalMode === "all_admins" ? Math.max(adminCount, 1) : 1;
          const callerWillReleaseNow = adminApproversAfterClick >= threshold;
          const approvalLabel =
            req.approvalMode === "all_admins"
              ? `Needs every admin (${adminApprovers}/${Math.max(adminCount, 1)})`
              : "Needs 1 more admin";
          // Sub-account holders are disjoint from `members` on chain, so
          // the best we can do without joining `family_subaccounts` here is
          // shortenAddress + a generic fallback. Good enough for the
          // approval card; sub-account name appears in the SubAccountsPanel.
          const destinationLabel = req.recipientAddress
            ? subAddressSet.has(req.recipientAddress)
              ? `a sub-account (${shortenAddress(req.recipientAddress)})`
              : shortenAddress(req.recipientAddress)
            : "a sub-account";
          return (
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
                  {req.kind === "subaccount_fund" ? (
                    <span style={{ color: "var(--text-1)" }}>
                      <b>{labelForCaller(req.memberAddress)}</b> wants to top
                      up <b>{destinationLabel}</b> with{" "}
                      <b className="tabular">{formatPhpLocale(req.amountStroops)}</b>{" "}
                      from{" "}
                      <b>{displayEnvelopeName(req.envelope, envelopeNames)}</b>
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-1)" }}>
                      <b>{labelForCaller(req.memberAddress)}</b> wants{" "}
                      <b className="tabular">{formatPhpLocale(req.amountStroops)}</b>{" "}
                      from{" "}
                      <b>{displayEnvelopeName(req.envelope, envelopeNames)}</b>
                    </span>
                  )}
                </div>
                {req.memo ? (
                  <div
                    className="text-[12px] mt-1"
                    style={{ color: "var(--text-2)" }}
                  >
                    &quot;{req.memo}&quot;
                  </div>
                ) : null}
                <div
                  className="text-[11px] mt-1"
                  style={{ color: "var(--text-3)" }}
                >
                  {approvalLabel}
                </div>
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
                      {approveInFlight
                        ? "Approving…"
                        : callerWillReleaseNow
                          ? "Release"
                          : "Approve"}
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
          );
        })}
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
