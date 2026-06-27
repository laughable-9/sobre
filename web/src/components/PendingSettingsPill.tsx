"use client";

import { useState } from "react";
import { Clock4 } from "lucide-react";

import { useApplySettings } from "@/hooks/useApplySettings";
import { usePendingSettings } from "@/hooks/usePendingSettings";
import { formatPhpInt } from "@/lib/format";

/**
 * Surfaces a `pending_settings` row above the settings card. Admin gets
 * "Commit now" (sends one apply_settings tx) + "Discard" buttons; non-admins
 * see a read-only badge so both members know a change is staged.
 *
 * The Supabase mirror IS the truth for what the dashboard renders; this pill
 * exists to make clear that the chain hasn't caught up yet.
 */
export function PendingSettingsPill({
  userAddress,
  familyWalletId,
  contractId,
  isAdmin,
  onCommitted,
}: {
  userAddress: string | null;
  familyWalletId: string | null;
  contractId: string;
  isAdmin: boolean;
  onCommitted: () => void;
}) {
  const { pending } = usePendingSettings(familyWalletId);
  const { commitPending, cancelPending, pending: txPending, error } =
    useApplySettings(userAddress);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  if (!pending) return null;

  const summary = describePending(pending);

  const handleCommit = async () => {
    if (!pending) return;
    try {
      await commitPending(contractId, pending);
      onCommitted();
    } catch {
      // surfaces via hook error
    }
  };

  const handleDiscard = async () => {
    if (!pending) return;
    try {
      await cancelPending(pending.familyWalletId);
      setConfirmingDiscard(false);
    } catch {
      // surfaces via hook error
    }
  };

  return (
    <div
      className="sobre-card-flat mb-4"
      style={{
        background: "#fff8ec",
        borderColor: "#f0d59a",
        padding: "12px 16px",
      }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <Clock4
          size={16}
          strokeWidth={2.2}
          style={{ marginTop: 2, color: "var(--sobre-accent)" }}
        />
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Settings change pending commit
          </div>
          <ul className="text-xs mt-1 space-y-0.5" style={{ color: "var(--text-2)" }}>
            {summary.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
          {error ? (
            <p
              className="text-xs mt-2 break-all"
              style={{ color: "var(--sobre-danger)" }}
            >
              {error}
            </p>
          ) : null}
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={txPending}
              className="sobre-btn sobre-btn-primary"
              style={{ padding: "8px 14px", fontSize: 12 }}
            >
              {txPending ? "Committing…" : "Commit now"}
            </button>
            {confirmingDiscard ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleDiscard()}
                  disabled={txPending}
                  className="sobre-btn sobre-btn-danger"
                  style={{ padding: "8px 12px", fontSize: 12 }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(false)}
                  disabled={txPending}
                  className="sobre-btn sobre-btn-soft"
                  style={{ padding: "8px 12px", fontSize: 12 }}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDiscard(true)}
                disabled={txPending}
                className="sobre-btn sobre-btn-soft"
                style={{ padding: "8px 12px", fontSize: 12 }}
              >
                Discard
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function describePending(
  pending: NonNullable<ReturnType<typeof usePendingSettings>["pending"]>,
): string[] {
  const out: string[] = [];
  if (pending.percents) {
    out.push(
      `Split → ${pending.percents[0]}% / ${pending.percents[1]}% / ${pending.percents[2]}%`,
    );
  }
  if (pending.policy) {
    if (pending.policy.requireAllSigs) {
      out.push("Every spend will need admin approval");
    }
    if (pending.policy.dailyLimit !== null) {
      out.push(
        `Daily limit per member → ${formatPhpInt(pending.policy.dailyLimit)}`,
      );
    }
    if (pending.policy.perTxThreshold !== null) {
      out.push(
        `Approval required above → ${formatPhpInt(pending.policy.perTxThreshold)}`,
      );
    } else if (pending.policy.dailyLimit !== null || pending.policy.requireAllSigs) {
      // Mention the threshold being cleared only if the policy is otherwise
      // changing (so an empty policy save doesn't generate noisy "→ none"
      // bullets for fields the admin didn't touch).
      out.push("Per-tx approval threshold → none");
    }
    if (pending.policy.protectedEnvelopes.length > 0) {
      out.push(
        `Envelopes requiring approval → ${pending.policy.protectedEnvelopes.join(", ")}`,
      );
    }
  }
  return out.length === 0 ? ["(empty change)"] : out;
}
