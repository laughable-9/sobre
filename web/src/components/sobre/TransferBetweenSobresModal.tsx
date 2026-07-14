"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Avatar } from "@/components/sobre/Avatar";
import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { Sheet } from "@/components/sobre/Sheet";
import { useCashoutApproval } from "@/hooks/useCashoutApproval";
import { useTransferBetweenSobres } from "@/hooks/useTransferBetweenSobres";
import {
  useTransferDestinations,
  type TransferDestination,
} from "@/hooks/useTransferDestinations";
import type { WalletState } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { envelopeTotalStroops } from "@/lib/walletTotals";

/**
 * Inter-Sobre transfer.
 *
 *  Two passkey prompts:
 *    1. `withdraw(caller, envelope, amount, memo)` on the source Sobre —
 *       envelope debits, tokens land in the user's smart wallet.
 *    2. `deposit_with_split(from, g, t, s)` on the destination Sobre —
 *       user's smart wallet debits, destination envelopes credit per its
 *       own split percentages (fetched at pick-time).
 *
 *  Multi-admin approval: if the source envelope sits in
 *  `state.policy.protectedEnvelopes` AND the family has 2+ admins, the
 *  transfer routes through `family_pending_requests` with kind='transfer'
 *  first — same shape as the cashout gate. Solo-admin skips the wait.
 */
export function TransferBetweenSobresModal({
  userAddress,
  contractId,
  state,
  familyWalletId,
  memberWalletDbId,
  initialEnvelope,
  onClose,
  onSuccess,
  onFlash,
}: {
  userAddress: string;
  contractId: string;
  state: WalletState;
  familyWalletId: string | null;
  memberWalletDbId: string | null;
  /** Pre-select the source envelope when entering from an envelope card. */
  initialEnvelope?: EnvelopeName;
  onClose: () => void;
  onSuccess: () => void;
  onFlash: (msg: string, kind?: "ok" | "warn") => void;
}) {
  const [envelope, setEnvelope] = useState<EnvelopeName>(
    initialEnvelope ?? "Groceries",
  );
  const [destination, setDestination] = useState<TransferDestination | null>(
    null,
  );
  const [amount, setAmount] = useState<string>("500");
  const [destPercents, setDestPercents] = useState<
    [number, number, number] | null
  >(null);
  const [phase, setPhase] = useState<
    "input" | "awaiting_approval" | "signing" | "done" | "error"
  >("input");
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const { destinations, loading: destsLoading } = useTransferDestinations(
    contractId,
  );
  const { transfer, pending: transferPending, error: transferError, step } =
    useTransferBetweenSobres(userAddress);

  // Load the destination Sobre's percents whenever a new destination
  // is picked — the on-chain deposit_with_split needs [g, t, s] and
  // we prefer the household's own split over any client fallback.
  useEffect(() => {
    // External-sync effect: fetches the destination Sobre's percents
    // whenever the picker changes.
    if (!destination) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDestPercents(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("family_wallets")
        .select("percents")
        .eq("contract_id", destination.contractId)
        .maybeSingle();
      if (cancelled) return;
      const raw = (data as { percents: number[] | null } | null)?.percents;
      if (raw && raw.length === 3) {
        setDestPercents([raw[0]!, raw[1]!, raw[2]!]);
      } else {
        setDestPercents([50, 30, 20]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destination]);

  const envIdx = ENVELOPE_LABELS.indexOf(envelope);
  const envelopeBalancePhp =
    (Number(envelopeTotalStroops(state, envIdx)) / STROOPS_PER_USDC) *
    PHP_PER_USDC;
  const parsed = Number(amount);
  const validAmount = parsed > 0 && Number.isFinite(parsed);
  const stroopsRequested = validAmount
    ? BigInt(Math.round((parsed / PHP_PER_USDC) * STROOPS_PER_USDC))
    : 0n;
  const canSubmit =
    validAmount &&
    parsed <= envelopeBalancePhp &&
    destination !== null &&
    destPercents !== null;

  const envelopeProtected = state.policy.protectedEnvelopes.includes(envelope);
  const totalAdmins = state.admins.length;
  const needsApproval = envelopeProtected && totalAdmins > 1;
  const approval = useCashoutApproval({
    familyWalletId,
    memberWalletDbId,
    envelope,
    amountStroops: stroopsRequested,
    kind: "transfer",
    recipientAddress: destination?.contractId ?? null,
  });
  const approvalsRemaining = Math.max(
    0,
    totalAdmins - approval.approvers.length,
  );

  const runOnChain = async () => {
    if (!destination || !destPercents || stroopsRequested <= 0n) return;
    setPhase("signing");
    try {
      await transfer({
        sourceContractId: contractId,
        sourceEnvelope: envelope,
        destinationContractId: destination.contractId,
        destinationPercents: destPercents,
        amountStroops: stroopsRequested,
        destinationDisplayName: destination.displayName,
      });
      approval.reset();
      onFlash(
        `Sent ₱${parsed.toLocaleString("en-PH", { minimumFractionDigits: 2 })} to ${destination.displayName}`,
      );
      onSuccess();
      setPhase("done");
    } catch (e) {
      setFlashMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  useEffect(() => {
    // External-sync effect: approval.status polls Supabase.
    if (phase !== "awaiting_approval") return;
    if (approval.status === "approved") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runOnChain();
    } else if (approval.status === "denied") {
      setPhase("input");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, approval.status]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!needsApproval) {
      await runOnChain();
      return;
    }
    setPhase("awaiting_approval");
    const id = await approval.create({ memo: "Inter-Sobre transfer" });
    if (!id) setPhase("input");
  };

  const envelopeLabel = displayEnvelopeName(envelope, state.envelope_names);
  const availableEnvelopes = useMemo(() => ENVELOPE_LABELS, []);

  if (phase === "awaiting_approval") {
    return (
      <Sheet onClose={onClose} ariaLabel="Waiting for approval">
        <h2>Waiting for the other admin{totalAdmins > 2 ? "s" : ""}</h2>
        <p className="sub">
          {envelopeLabel} is a locked envelope. Every admin needs to approve
          before ₱{Math.round(parsed).toLocaleString("en-PH")} can move to{" "}
          {destination?.displayName ?? "the other Sobre"}.
        </p>
        <div
          className="rounded-[10px] px-4 py-4 mt-3 mb-4"
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="flex items-center gap-3 text-[13px]"
            style={{ color: "var(--text-1)", fontWeight: 600 }}
          >
            <Loader2 size={16} className="animate-spin" />
            {approval.approvers.length} of {totalAdmins} approved
            {approvalsRemaining > 0 ? (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-3)", fontWeight: 500 }}
              >
                · {approvalsRemaining} to go
              </span>
            ) : null}
          </div>
        </div>
        {approval.error ? (
          <p
            className="text-[12px] mb-3"
            style={{ color: "var(--sobre-danger)" }}
          >
            {approval.error}
          </p>
        ) : null}
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={() => {
              void approval.cancel();
              setPhase("input");
            }}
          >
            Cancel request
          </button>
        </div>
      </Sheet>
    );
  }

  if (phase === "signing") {
    return (
      <Sheet onClose={onClose} ariaLabel="Transferring">
        <CenteredCopy
          icon={<Loader2 size={28} className="animate-spin" />}
          title={
            step === "depositing"
              ? "Confirm in your passkey (2 of 2)"
              : "Confirm in your passkey (1 of 2)"
          }
        />
      </Sheet>
    );
  }

  if (phase === "done") {
    return (
      <Sheet onClose={onClose} ariaLabel="Transfer complete">
        <h2>Transferred</h2>
        <p className="sub">
          ₱{parsed.toLocaleString("en-PH", { minimumFractionDigits: 2 })} landed
          in {destination?.displayName}.
        </p>
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  if (phase === "error") {
    return (
      <Sheet onClose={onClose} ariaLabel="Transfer failed">
        <h2>Something went wrong</h2>
        <p
          className="sub"
          style={{ color: "var(--sobre-danger)" }}
        >
          {flashMsg ?? transferError ?? "The transfer couldn't complete."}
        </p>
        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={() => setPhase("input")}
          >
            Try again
          </button>
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Transfer to another Sobre">
      <h2>Send to another Sobre</h2>
      <p className="sub">
        Move money from this Sobre to another one you help run. Two quick
        passkey prompts.
      </p>

      <div className="sobre-input-group">
        <label>From envelope</label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {availableEnvelopes.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEnvelope(e)}
              className="rounded-[10px] text-[13px] px-3 py-2"
              style={{
                border:
                  envelope === e
                    ? "1.5px solid var(--sobre-accent)"
                    : "1px solid var(--border)",
                background:
                  envelope === e ? "var(--accent-soft)" : "var(--surface)",
                color:
                  envelope === e ? "var(--sobre-accent)" : "var(--text-1)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {displayEnvelopeName(e, state.envelope_names)}
            </button>
          ))}
        </div>
        <div
          className="mt-2 text-[12px] tabular"
          style={{ color: "var(--text-3)" }}
        >
          Available: ₱
          {envelopeBalancePhp.toLocaleString("en-PH", {
            maximumFractionDigits: 2,
          })}
        </div>
      </div>

      <div className="sobre-input-group">
        <label>To Sobre</label>
        {destsLoading ? (
          <div
            className="text-[12px] mt-1"
            style={{ color: "var(--text-3)" }}
          >
            Loading your other Sobres…
          </div>
        ) : destinations.length === 0 ? (
          <div
            style={{
              padding: "12px",
              borderRadius: 10,
              border: "1px dashed var(--border)",
              fontSize: 12,
              color: "var(--text-3)",
            }}
          >
            You don&apos;t have another Sobre to transfer to yet. Open a
            second Sobre from the My Sobres page.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {destinations.map((d) => {
              const active = destination?.contractId === d.contractId;
              return (
                <button
                  key={d.contractId}
                  type="button"
                  onClick={() => setDestination(d)}
                  className="flex items-center gap-3 p-3 rounded-[10px] text-left"
                  style={{
                    border: active
                      ? "1.5px solid var(--sobre-accent)"
                      : "1px solid var(--border)",
                    background: active
                      ? "var(--accent-soft)"
                      : "var(--surface-alt)",
                    cursor: "pointer",
                  }}
                >
                  <Avatar src={null} name={d.displayName} size={32} />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-1)",
                    }}
                  >
                    {d.displayName}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="sobre-input-group">
        <label>Amount</label>
        <div className="flex items-center gap-1">
          <span
            style={{ color: "var(--text-3)", fontSize: 16 }}
            aria-hidden
          >
            ₱
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Transfer amount in pesos"
            style={{
              flex: 1,
              fontSize: 20,
              fontVariantNumeric: "tabular-nums",
              background: "transparent",
              border: "none",
              outline: "none",
              padding: "4px 0",
              borderBottom: "1px solid var(--border-strong)",
              color: "var(--text-1)",
            }}
          />
        </div>
        {parsed > envelopeBalancePhp && validAmount ? (
          <div
            className="mt-1 text-[12px]"
            style={{ color: "var(--sobre-danger)" }}
          >
            More than the envelope holds.
          </div>
        ) : null}
      </div>

      {destination ? (
        <div
          className="rounded-[10px] px-3 py-3 mb-3 text-[12px] flex items-center gap-2"
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            color: "var(--text-2)",
          }}
        >
          <span>{envelopeLabel}</span>
          <ArrowRight size={12} strokeWidth={2.2} />
          <span>
            {destination.displayName}
            {destPercents ? (
              <span
                className="ml-2 tabular"
                style={{ color: "var(--text-3)" }}
              >
                {destPercents[0]}% / {destPercents[1]}% / {destPercents[2]}%
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="sobre-modal-actions">
        <button
          type="button"
          className="sobre-btn sobre-btn-soft"
          onClick={onClose}
          disabled={transferPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sobre-btn sobre-btn-primary"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || transferPending}
          style={
            !canSubmit || transferPending ? { opacity: 0.5 } : undefined
          }
        >
          {needsApproval ? "Request approval" : "Transfer"}
        </button>
      </div>
    </Sheet>
  );
}
