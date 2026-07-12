"use client";

import { useEffect, useState } from "react";

import { simulateRead } from "@/lib/contract";
import type { Member } from "@/hooks/useWalletState";

export interface SobreSummary {
  walletName: string;
  members: Member[];
  totalStroops: bigint;
  isClosed: boolean;
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
 * `isClosed` is a heuristic: balances all zero and a WalletClosed event has
 * been emitted by this contract. We don't query events here for speed; the
 * close detection happens at the dashboard level (localStorage flag set on
 * close + cross-checked). Closed Sobres still render with their last-known
 * member list and a "Closed" pill.
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
        const raw = await simulateRead<Record<string, unknown>>(
          contractId,
          "get_state",
          [],
        );
        if (cancelled) return;
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
          walletName: String(raw.wallet_name ?? "Family Wallet"),
          members,
          totalStroops,
          isClosed: false,
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
