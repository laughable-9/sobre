"use client";

import { useCallback, useEffect, useState } from "react";

import type { SpendPolicyShape } from "@/lib/contract";
import type { EnvelopeName } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface PendingSettingsRow {
  familyWalletId: string;
  percents: [number, number, number] | null;
  /** Whole-policy replacement intent. per_tx_threshold lives inside. */
  policy: SpendPolicyShape | null;
  intendedAt: string;
}

export interface UsePendingSettingsResult {
  pending: PendingSettingsRow | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

interface RawRow {
  family_wallet_id: string;
  percents: number[] | null;
  policy_json: {
    require_all_sigs: boolean;
    daily_limit: string | number | null;
    per_tx_threshold: string | number | null;
    protected_envelopes: EnvelopeName[];
  } | null;
  intended_at: string;
}

function normalize(raw: RawRow | null): PendingSettingsRow | null {
  if (!raw) return null;
  const optBigint = (v: string | number | null | undefined) =>
    v === null || v === undefined ? null : BigInt(v);
  return {
    familyWalletId: raw.family_wallet_id,
    percents:
      raw.percents && raw.percents.length === 3
        ? [raw.percents[0]!, raw.percents[1]!, raw.percents[2]!]
        : null,
    policy: raw.policy_json
      ? {
          requireAllSigs: Boolean(raw.policy_json.require_all_sigs),
          dailyLimit: optBigint(raw.policy_json.daily_limit),
          perTxThreshold: optBigint(raw.policy_json.per_tx_threshold),
          protectedEnvelopes: raw.policy_json.protected_envelopes ?? [],
        }
      : null,
    intendedAt: raw.intended_at,
  };
}

/**
 * Reads the family's `pending_settings` row with Realtime updates. Returns
 * null when there's no pending change (row absent or deleted post-commit).
 * Used by the dashboard pill + the Commit Now button.
 *
 * Realtime payloads carry the new row, so we update from `payload.new`
 * directly instead of re-fetching — saves a round-trip per change.
 */
export function usePendingSettings(
  familyWalletId: string | null,
): UsePendingSettingsResult {
  const [pending, setPending] = useState<PendingSettingsRow | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchOne = useCallback(async () => {
    if (!familyWalletId) {
      setPending(null);
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("pending_settings")
        .select("*")
        .eq("family_wallet_id", familyWalletId)
        .maybeSingle();
      setPending(normalize(data as RawRow | null));
    } finally {
      setLoading(false);
    }
  }, [familyWalletId]);

  useEffect(() => {
    void fetchOne();
  }, [fetchOne]);

  useEffect(() => {
    if (!familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`pending-settings:${familyWalletId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "pending_settings",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        (payload: { new: RawRow | null; eventType: string }) => {
          if (payload.eventType === "DELETE") setPending(null);
          else setPending(normalize(payload.new));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyWalletId]);

  return { pending, loading, refresh: fetchOne };
}
