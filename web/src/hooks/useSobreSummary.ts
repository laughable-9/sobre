"use client";

import { useEffect, useState } from "react";

import { simulateRead } from "@/lib/contract";
import type { Member } from "@/hooks/useWalletState";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface SobreSummary {
  walletName: string;
  members: Member[];
  totalStroops: bigint;
  isClosed: boolean;
  /** True when the contract exists on chain but has no matching Supabase
   *  `family_wallets` row (typically an orphan from a create where the DB
   *  mirror failed). Consumers can hide these from the list. */
  isOrphan: boolean;
}

export interface UseSobreSummaryResult {
  summary: SobreSummary | null;
  loading: boolean;
  error: string | null;
}

/**
 * One-shot fetch of a Sobre's state for the "My Sobres" cards. Cheaper than
 * useWalletState which polls every 3s — these cards just need a snapshot.
 *
 * The wallet display name lives in Supabase (family_wallets.display_name),
 * not on chain, so we read it from there and combine with the chain-side
 * balances + member list. If no Supabase row exists we mark the summary as
 * an orphan; the /dashboard list filters those out.
 */
export function useSobreSummary(
  contractId: string,
  callerAddress: string | null,
): UseSobreSummaryResult {
  const [summary, setSummary] = useState<SobreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callerAddress) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const [rawSettled, familySettled] = await Promise.allSettled([
          simulateRead<Record<string, unknown>>(contractId, "get_state", []),
          supabase
            .from("family_wallets")
            .select("display_name")
            .eq("contract_id", contractId)
            .maybeSingle(),
        ]);
        if (cancelled) return;

        if (rawSettled.status === "rejected") {
          throw rawSettled.reason instanceof Error
            ? rawSettled.reason
            : new Error(String(rawSettled.reason));
        }
        const raw = rawSettled.value;
        const familyRow =
          familySettled.status === "fulfilled" && !familySettled.value.error
            ? (familySettled.value.data as { display_name: string | null } | null)
            : null;
        const supabaseName = familyRow?.display_name ?? null;

        const members: Member[] = Array.isArray(raw.members)
          ? (raw.members as Record<string, unknown>[]).map((m) => ({
              address: String(m.address),
              name: String(m.name ?? ""),
              avatarUrl: null,
              walletDbId: null,
              role: "recipient",
            }))
          : [];
        const balances = (raw.balances as bigint[] | undefined) ?? [];
        const totalStroops = balances.reduce((acc, b) => acc + b, 0n);
        setSummary({
          walletName:
            supabaseName ?? String(raw.wallet_name ?? "") ?? "Family Wallet",
          members,
          totalStroops,
          isClosed: false,
          isOrphan: familyRow === null,
        });
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId, callerAddress]);

  return { summary, loading, error };
}
