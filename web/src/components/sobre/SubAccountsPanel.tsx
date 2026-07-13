"use client";

import { useMemo, useState } from "react";
import { Activity, Lock, LockOpen, Send, XCircle } from "lucide-react";

import { useCancelSubaccountInvite } from "@/hooks/useCancelSubaccountInvite";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import { useToggleSubaccountLock } from "@/hooks/useToggleSubaccountLock";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { SubAccount, WalletState } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { friendlyError } from "@/lib/format";

import { Avatar } from "./Avatar";
import { ConfirmSheet } from "./ConfirmSheet";
import { FundSubAccountModal } from "./FundSubAccountModal";
import { SubAccountInviteModal } from "./SubAccountInviteModal";
import { SupplementaryDetailModal } from "./SupplementaryDetailModal";

interface PanelProps {
  userAddress: string;
  contractId: string;
  familyWalletId: string | null;
  rows: FamilySubaccountRow[];
  state: WalletState;
  events: FeedEvent[];
  isAdmin: boolean;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
  onChange: () => void;
}

interface MergedSub {
  row: FamilySubaccountRow;
  chain: SubAccount | null;
}

function mergeRows(
  rows: FamilySubaccountRow[],
  onChain: SubAccount[],
): MergedSub[] {
  const byAddress = new Map(onChain.map((s) => [s.address, s] as const));
  return rows.map((row) => ({
    row,
    chain: row.walletAddress ? (byAddress.get(row.walletAddress) ?? null) : null,
  }));
}

export function SubAccountsPanel({
  userAddress,
  contractId,
  familyWalletId,
  rows,
  state,
  events,
  isAdmin,
  onFlash,
  onChange,
}: PanelProps) {
  const [sendTarget, setSendTarget] = useState<MergedSub | null>(null);
  const [historyTarget, setHistoryTarget] = useState<MergedSub | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const merged = useMemo(
    () => mergeRows(rows, state.subaccounts),
    [rows, state.subaccounts],
  );

  // Members can read sub-accounts but can't fund/lock — hide the
  // panel entirely from members when there are no subs yet so the
  // page doesn't render an empty "Sub-accounts" card with no actions.
  if (!isAdmin && merged.length === 0) return null;

  return (
    <section className="sobre-envs-section" aria-label="Supplementary">
      <div className="sobre-envs-section-head">
        <h3>Supplementary</h3>
        {isAdmin ? (
          <button
            type="button"
            className="sobre-envs-section-action"
            onClick={() => setInviteOpen(true)}
          >
            Add
          </button>
        ) : null}
      </div>

      {merged.length === 0 ? (
        <div
          style={{
            padding: "16px 14px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--sobre-text-3)",
            border: "1px dashed var(--sobre-border)",
            borderRadius: 14,
          }}
        >
          No supplementary accounts yet.
        </div>
      ) : (
        merged.map((m) => (
          <SubCard
            key={m.row.id}
            sub={m}
            canAct={isAdmin}
            onSend={() => setSendTarget(m)}
            onHistory={() => setHistoryTarget(m)}
            userAddress={userAddress}
            contractId={contractId}
            onFlash={onFlash}
            onChange={onChange}
          />
        ))
      )}

      {historyTarget ? (
        <SupplementaryDetailModal
          row={historyTarget.row}
          chain={historyTarget.chain}
          events={events}
          envelopeNames={state.envelope_names}
          currency="PHP"
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}

      {sendTarget && sendTarget.row.walletAddress ? (
        <FundSubAccountModal
          userAddress={userAddress}
          contractId={contractId}
          state={state}
          subRows={rows}
          initialTarget={{
            address: sendTarget.row.walletAddress,
            displayName: sendTarget.row.displayName,
          }}
          onClose={() => setSendTarget(null)}
          onSuccess={() => {
            setSendTarget(null);
            onChange();
          }}
          onFlash={onFlash}
        />
      ) : null}

      {inviteOpen ? (
        <SubAccountInviteModal
          adminAddress={userAddress}
          contractId={contractId}
          familyWalletId={familyWalletId}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </section>
  );
}

interface CardProps {
  sub: MergedSub;
  canAct: boolean;
  onSend: () => void;
  onHistory: () => void;
  userAddress: string;
  contractId: string;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
  onChange: () => void;
}

function SubCard({
  sub,
  canAct,
  onSend,
  onHistory,
  userAddress,
  contractId,
  onFlash,
  onChange,
}: CardProps) {
  const { toggle, pending: lockPending } = useToggleSubaccountLock(
    userAddress,
    contractId,
  );
  const { cancel: cancelInvite, pending: cancelPending } =
    useCancelSubaccountInvite(userAddress, contractId);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { row, chain } = sub;
  // Pending = the invite hasn't been redeemed in Supabase yet (wallet_id
  // is null). Don't conflate this with "chain match missing": once the row
  // is claimed, a transient gap between Supabase realtime and the on-chain
  // poll could leave `chain` null briefly even though the joiner is fully
  // on-chain. Reading row.invitePending keeps the pending chip honest.
  const isPending = sub.row.invitePending;
  const isLocked = chain?.locked ?? false;

  const balanceStroops = chain?.balance ?? 0n;
  const balancePhp =
    (Number(balanceStroops) / STROOPS_PER_USDC) * PHP_PER_USDC;

  const handleToggle = async () => {
    if (!row.walletAddress) return;
    try {
      await toggle(row.walletAddress, isLocked);
      onFlash(isLocked ? `${row.displayName} unlocked` : `${row.displayName} locked`);
      onChange();
    } catch {
      // surfaced via the lock hook error state
    }
  };

  const openCancelConfirm = () => {
    if (!row.inviteTokenHash) {
      onFlash(
        "This invite predates the cancel feature. Delete the row manually or wait for it to expire.",
        "warn",
      );
      return;
    }
    setConfirmingCancel(true);
  };

  const confirmCancelInvite = async () => {
    if (!row.inviteTokenHash) return;
    try {
      await cancelInvite(row.inviteTokenHash);
      onFlash("Invite cancelled");
      setConfirmingCancel(false);
      onChange();
    } catch (e) {
      onFlash(friendlyError(e), "warn");
      setConfirmingCancel(false);
    }
  };

  return (
    <div className="sobre-card-flat" style={{ padding: 0, marginBottom: 10 }}>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar src={null} name={row.displayName} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {row.displayName}
              {isPending ? (
                <span style={PENDING_CHIP}>Invite pending</span>
              ) : null}
              {isLocked ? (
                <span style={LOCKED_CHIP}>
                  <Lock size={10} strokeWidth={2.4} />
                  Locked
                </span>
              ) : null}
            </div>
            <div
              className="tabular"
              style={{
                fontSize: 22,
                fontWeight: 600,
                marginTop: 2,
                letterSpacing: "-0.01em",
                color: isPending ? "var(--text-3)" : "var(--text-1)",
              }}
            >
              ₱
              {balancePhp.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}
            >
              {isPending ? "Awaiting sign-up" : "Available balance"}
            </div>
          </div>
        </div>

        {canAct && isPending ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 6,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              onClick={openCancelConfirm}
              disabled={cancelPending}
              className="sobre-btn sobre-btn-soft"
              style={{
                justifyContent: "center",
                padding: "10px 8px",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--sobre-danger)",
                opacity: cancelPending ? 0.6 : 1,
              }}
            >
              <XCircle size={12} strokeWidth={2.4} />
              {cancelPending ? "Cancelling…" : "Cancel invite"}
            </button>
          </div>
        ) : canAct ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              onClick={onSend}
              className="sobre-btn sobre-btn-primary"
              style={{
                justifyContent: "center",
                padding: "10px 8px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <Send size={12} strokeWidth={2.4} />
              Send
            </button>
            <button
              type="button"
              onClick={handleToggle}
              disabled={lockPending}
              className="sobre-btn sobre-btn-soft"
              style={{
                justifyContent: "center",
                padding: "10px 8px",
                fontSize: 12,
                fontWeight: 600,
                opacity: lockPending ? 0.6 : 1,
                color: isLocked ? "var(--sobre-accent)" : "var(--sobre-danger)",
              }}
            >
              {isLocked ? (
                <>
                  <LockOpen size={12} strokeWidth={2.4} />
                  Unlock
                </>
              ) : (
                <>
                  <Lock size={12} strokeWidth={2.4} />
                  Lock
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onHistory}
              className="sobre-btn sobre-btn-soft"
              style={{
                justifyContent: "center",
                padding: "10px 8px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <Activity size={12} strokeWidth={2.4} />
              History
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmSheet
        open={confirmingCancel}
        title="Cancel this invite?"
        body="The share link becomes unredeemable and the pending row disappears. You can send a fresh invite afterwards."
        confirmLabel="Cancel invite"
        cancelLabel="Keep it"
        confirmTone="danger"
        pending={cancelPending}
        onConfirm={() => void confirmCancelInvite()}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}

const CHIP_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 7px",
  borderRadius: 999,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const LOCKED_CHIP: React.CSSProperties = {
  ...CHIP_BASE,
  color: "var(--sobre-danger)",
  background: "#fbe9e6",
};

const PENDING_CHIP: React.CSSProperties = {
  ...CHIP_BASE,
  color: "var(--sobre-accent)",
  background: "var(--accent-soft)",
};
