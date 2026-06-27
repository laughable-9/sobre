"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Lock,
  LockOpen,
  Send,
  UserPlus,
} from "lucide-react";

import { useCreatePendingRequest } from "@/hooks/useCreatePendingRequest";
import { useFundSubaccount } from "@/hooks/useFundSubaccount";
import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import { useToggleSubaccountLock } from "@/hooks/useToggleSubaccountLock";
import { subaccountActivity } from "@/lib/sobre/subaccountActivity";
import type { FeedEvent } from "@/hooks/useTxFeed";
import type { SubAccount, WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { routeSpend } from "@/lib/policy";
import { backdropClose } from "@/lib/ui";

import { SubAccountInviteModal } from "./SubAccountInviteModal";

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    <section
      className="mx-auto w-full px-4 sm:px-7 pb-12 pt-4"
      style={{ maxWidth: 1320 }}
    >
      <header className="flex items-end justify-between mb-5">
        <div>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            Supplementary accounts
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              margin: "4px 0 0",
            }}
          >
            Top up from any envelope. Lock to freeze their spending instantly.
          </p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="sobre-btn sobre-btn-soft"
            style={{ fontSize: 12, padding: "8px 12px" }}
          >
            <UserPlus size={14} strokeWidth={2.2} />
            New supplementary
          </button>
        ) : null}
      </header>

      {merged.length === 0 ? (
        <div
          className="sobre-card-flat"
          style={{
            padding: "18px 16px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-3)",
          }}
        >
          No supplementary accounts yet. Invite someone to add one.
        </div>
      ) : (
        merged.map((m) => (
          <SubCard
            key={m.row.id}
            sub={m}
            envelopeNames={state.envelope_names}
            events={events}
            expanded={expandedId === m.row.id}
            canAct={isAdmin}
            onToggleExpand={() =>
              setExpandedId((cur) => (cur === m.row.id ? null : m.row.id))
            }
            onSend={() => setSendTarget(m)}
            userAddress={userAddress}
            contractId={contractId}
            onFlash={onFlash}
            onChange={onChange}
          />
        ))
      )}

      {sendTarget && sendTarget.chain && sendTarget.row.walletAddress ? (
        <SendSubAccountModal
          target={sendTarget}
          state={state}
          familyWalletId={familyWalletId}
          userAddress={userAddress}
          contractId={contractId}
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
          walletName={state.wallet_name}
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
  envelopeNames: string[];
  events: FeedEvent[];
  expanded: boolean;
  canAct: boolean;
  onToggleExpand: () => void;
  onSend: () => void;
  userAddress: string;
  contractId: string;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
  onChange: () => void;
}

function SubCard({
  sub,
  envelopeNames,
  events,
  expanded,
  canAct,
  onToggleExpand,
  onSend,
  userAddress,
  contractId,
  onFlash,
  onChange,
}: CardProps) {
  const { toggle, pending: lockPending } = useToggleSubaccountLock(
    userAddress,
    contractId,
  );
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

  const history = useMemo(
    () =>
      subaccountActivity(events, row.walletAddress, envelopeNames, {
        limit: 6,
      }),
    [events, row.walletAddress, envelopeNames],
  );

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

  return (
    <div className="sobre-card-flat" style={{ padding: 0, marginBottom: 10 }}>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              display: "grid",
              placeItems: "center",
              fontSize: 22,
            }}
          >
            {row.emoji}
          </div>
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
                fontFamily: "var(--serif)",
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
              {isPending ? "Awaiting sign-up" : "Spendable balance"}
            </div>
          </div>
        </div>

        {canAct ? (
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
              disabled={isPending}
              className="sobre-btn sobre-btn-primary"
              style={{
                justifyContent: "center",
                padding: "10px 8px",
                fontSize: 12,
                fontWeight: 600,
                opacity: isPending ? 0.45 : 1,
                cursor: isPending ? "not-allowed" : "pointer",
              }}
            >
              <Send size={12} strokeWidth={2.4} />
              Send
            </button>
            <button
              type="button"
              onClick={handleToggle}
              disabled={isPending || lockPending}
              className="sobre-btn sobre-btn-soft"
              style={{
                justifyContent: "center",
                padding: "10px 8px",
                fontSize: 12,
                fontWeight: 600,
                opacity: isPending || lockPending ? 0.6 : 1,
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
              onClick={onToggleExpand}
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
              {expanded ? (
                <ChevronUp size={12} strokeWidth={2.4} />
              ) : (
                <ChevronDown size={12} strokeWidth={2.4} />
              )}
            </button>
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            padding: "12px 16px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 8,
            }}
          >
            Recent activity
          </div>
          {history.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              Nothing yet.
            </div>
          ) : (
            history.map((h, i) => (
              <div
                key={`${h.txHash}:${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                  fontSize: 12,
                  borderBottom:
                    i === history.length - 1
                      ? "none"
                      : "1px dashed var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{h.label}</div>
                  <div style={{ color: "var(--text-3)", fontSize: 11 }}>
                    {formatRel(h.whenIso)}
                  </div>
                </div>
                <div
                  className="tabular"
                  style={{
                    fontWeight: 600,
                    color:
                      h.direction === "in"
                        ? "var(--sobre-accent)"
                        : "var(--text-1)",
                  }}
                >
                  {h.direction === "in" ? "+" : "-"}₱
                  {h.php.toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

interface SendModalProps {
  target: MergedSub;
  state: WalletState;
  familyWalletId: string | null;
  userAddress: string;
  contractId: string;
  onClose: () => void;
  onSuccess: () => void;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
}

function SendSubAccountModal({
  target,
  state,
  familyWalletId,
  userAddress,
  contractId,
  onClose,
  onSuccess,
  onFlash,
}: SendModalProps) {
  const balances = state.balances;
  const envelopeNames = state.envelope_names;
  const [envelope, setEnvelope] = useState<EnvelopeName>("Groceries");
  const [amount, setAmount] = useState<string>("500");
  const { fund, pending: fundPending, error: fundError } = useFundSubaccount(
    userAddress,
    contractId,
  );
  // Admin's own wallet UUID — they are the originator of any pending request
  // created here. Used to auto-record their approval at create-time (so the
  // 1-of-N count starts at 1).
  const adminWalletDbId =
    state.members.find((m) => m.address === userAddress)?.walletDbId ?? null;
  const {
    create: createPending,
    pending: pendingPending,
    error: pendingError,
  } = useCreatePendingRequest(userAddress, adminWalletDbId);
  const pending = fundPending || pendingPending;
  const error = fundError ?? pendingError;

  const recipient = target.row.walletAddress!;
  const parsed = Number(amount);
  const validAmount = parsed > 0 && Number.isFinite(parsed);

  const envelopeIndex = ENVELOPE_LABELS.indexOf(envelope);
  const envelopeBalancePhp =
    (Number(balances[envelopeIndex] ?? 0n) / STROOPS_PER_USDC) * PHP_PER_USDC;

  const ok = validAmount && parsed <= envelopeBalancePhp;

  // Funding a sub-account FROM Savings IS a Savings withdrawal — route the
  // decision through the same spec the spend modal reads. Daily limits and
  // per-tx threshold don't apply to admin-initiated sub-account top-ups, so
  // we pass `dailySpent: 0`; the Savings-lock branch sits before the admin
  // bypass in routeSpend specifically so admin-as-originator still routes
  // to pending.
  const stroopsRequested = validAmount
    ? BigInt(Math.round((parsed / PHP_PER_USDC) * STROOPS_PER_USDC))
    : 0n;
  const verdict = routeSpend({
    policy: state.policy,
    caller: userAddress,
    admin: state.admin,
    envelope,
    amountStroops: stroopsRequested,
    dailySpentStroops: 0n,
    envelopeBalanceStroops: balances[envelopeIndex] ?? 0n,
    savingsLockAllAdmins: state.savings_lock_all_admins,
    adminCount: state.admin_count,
  });
  const willGoPending = verdict.route === "pending";

  const handleSend = async () => {
    if (!ok || stroopsRequested <= 0n) return;
    try {
      if (willGoPending) {
        if (!familyWalletId) {
          throw new Error("Family record not loaded yet. Try again.");
        }
        await createPending({
          familyWalletId,
          envelope,
          amountStroops: stroopsRequested,
          memo: `Top up ${target.row.displayName}`,
          approvalMode: verdict.approvalMode,
          kind: "subaccount_fund",
          recipientAddress: recipient,
        });
        onFlash(
          `Requested ₱${parsed.toLocaleString("en-PH", { minimumFractionDigits: 2 })} for ${target.row.displayName}. Waiting on the other admins.`,
        );
      } else {
        await fund(envelope, recipient, stroopsRequested);
        onFlash(
          `Sent ₱${parsed.toLocaleString("en-PH", { minimumFractionDigits: 2 })} to ${target.row.displayName}`,
        );
      }
      onSuccess();
    } catch {
      // surfaced via the hook error states above
    }
  };

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div
        className="sobre-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <h2>
          Send to {target.row.displayName} {target.row.emoji}
        </h2>
        <p className="sub">
          Money leaves an envelope and lands in their spendable balance.
        </p>

        {willGoPending ? (
          <div
            className="text-xs"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
              marginBottom: 12,
            }}
          >
            Savings is locked. This will create a top-up request that every
            admin must approve.
          </div>
        ) : null}

        <div className="sobre-input-group">
          <label>Envelope</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {ENVELOPE_LABELS.map((e, i) => {
              const bal =
                (Number(balances[i] ?? 0n) / STROOPS_PER_USDC) * PHP_PER_USDC;
              const active = envelope === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEnvelope(e)}
                  disabled={pending}
                  className="flex flex-col items-start gap-1 p-3 rounded-[10px] text-left"
                  style={{
                    border: active
                      ? "1.5px solid var(--sobre-accent)"
                      : "1px solid var(--border)",
                    background: active
                      ? "var(--accent-soft)"
                      : "var(--surface-alt)",
                    cursor: pending ? "not-allowed" : "pointer",
                    opacity: pending ? 0.6 : 1,
                  }}
                >
                  <div
                    className="text-[13px] font-medium"
                    style={{
                      color: active ? "var(--sobre-accent)" : "var(--text-1)",
                    }}
                  >
                    {displayEnvelopeName(e, envelopeNames)}
                  </div>
                  <div
                    className="text-[11px] tabular"
                    style={{ color: "var(--text-3)" }}
                  >
                    ₱{bal.toLocaleString("en-PH", { maximumFractionDigits: 0 })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sobre-input-group">
          <label htmlFor="sub-fund-amount">Amount in pesos</label>
          <div className="sobre-input-wrap">
            <span className="prefix">₱</span>
            <input
              id="sub-fund-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="sobre-input has-prefix tabular"
              disabled={pending}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              marginTop: 6,
            }}
          >
            Envelope holds ₱
            {envelopeBalancePhp.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            .
          </div>
        </div>

        {error ? (
          <p
            className="text-xs break-all mb-3"
            style={{ color: "var(--sobre-danger)" }}
          >
            {error}
          </p>
        ) : null}

        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!ok || pending}
            className="sobre-btn sobre-btn-primary"
            style={{ opacity: !ok || pending ? 0.55 : 1 }}
          >
            {(() => {
              const verb = willGoPending ? "Request" : "Send";
              if (pending) return `${verb}ing…`;
              return `${verb} ₱${validAmount ? parsed.toLocaleString("en-PH") : "0"}`;
            })()}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
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
