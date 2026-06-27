"use client";

import { useCallback, useState } from "react";

import {
  invokeWrite,
  settingsFieldsArg,
  type SettingsField,
  type SpendPolicyShape,
} from "@/lib/contract";
import type { PendingSettingsRow } from "@/hooks/usePendingSettings";

export interface SettingsIntent {
  percents?: [number, number, number];
  /** Whole-policy replacement (includes per_tx_threshold). Omit to leave alone. */
  policy?: SpendPolicyShape;
}

export interface UseApplySettingsResult {
  /** Stage an intent in Supabase. No FaceID, no chain tx. Latest save wins. */
  stageIntent: (
    familyWalletId: string,
    intent: SettingsIntent,
  ) => Promise<void>;
  /** Commit the currently-pending intent to chain via apply_settings tx.
   *  One FaceID, one fee. Returns the tx hash. */
  commitPending: (
    contractId: string,
    pending: PendingSettingsRow,
  ) => Promise<string>;
  /** Drop the pending row without committing. */
  cancelPending: (familyWalletId: string) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/**
 * Pattern A's admin-side hook. Two phases:
 *
 *   1. `stageIntent(familyWalletId, intent)` — writes the intent to Supabase
 *      via `POST /api/settings/pending`. No FaceID, no fee. The dashboard's
 *      `usePendingSettings` picks it up via Realtime; the pill UI surfaces
 *      a "Commit now" affordance.
 *
 *   2. `commitPending(contractId, pending)` — sends a single
 *      `apply_settings(updates)` tx (one FaceID, ~$0.05 fee on mainnet),
 *      then DELETEs the pending row to clear the pill.
 *
 * Auto-bundling onto the next user tx (true zero-fee Pattern A) needs the
 * passkey-kit multi-op work tracked in feature-backlog → "Pre-signed auth
 * entries (true free-bundling)." For now admin commits explicitly.
 */
export function useApplySettings(
  adminAddress: string | null,
): UseApplySettingsResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageIntent = useCallback(
    async (familyWalletId: string, intent: SettingsIntent): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          family_wallet_id: familyWalletId,
        };
        if (intent.percents) body.percents = intent.percents;
        if (intent.policy) body.policy_json = serializePolicy(intent.policy);
        const res = await fetch("/api/settings/pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `stage failed: ${res.status}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  const commitPending = useCallback(
    async (
      contractId: string,
      row: PendingSettingsRow,
    ): Promise<string> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const fields = pendingToFields(row);
        if (fields.length === 0) throw new Error("Nothing to commit.");
        const { hash } = await invokeWrite(contractId, "apply_settings", [
          settingsFieldsArg(fields),
        ]);
        // The pill is driven entirely by the row's existence — deleting it
        // clears the UI. One round-trip serves "committed" and "cancelled."
        await deletePendingRow(row.familyWalletId);
        return hash;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  const cancelPending = useCallback(
    async (familyWalletId: string): Promise<void> => {
      if (!adminAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        await deletePendingRow(familyWalletId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [adminAddress],
  );

  return { stageIntent, commitPending, cancelPending, pending, error };
}

function serializePolicy(p: SpendPolicyShape) {
  return {
    require_all_sigs: p.requireAllSigs,
    daily_limit: p.dailyLimit === null ? null : p.dailyLimit.toString(),
    per_tx_threshold:
      p.perTxThreshold === null ? null : p.perTxThreshold.toString(),
    protected_envelopes: p.protectedEnvelopes,
  };
}

async function deletePendingRow(familyWalletId: string): Promise<void> {
  const res = await fetch(
    `/api/settings/pending?family_wallet_id=${encodeURIComponent(familyWalletId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `delete failed: ${res.status}`);
  }
}

function pendingToFields(row: PendingSettingsRow): SettingsField[] {
  const out: SettingsField[] = [];
  if (row.percents) out.push({ kind: "Percents", percents: row.percents });
  if (row.policy) out.push({ kind: "Policy", policy: row.policy });
  return out;
}
