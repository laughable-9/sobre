"use client";

import { useEffect, useState } from "react";

import { simulateRead } from "@/lib/contract";
import type { Member } from "@/hooks/useWalletState";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface SobreSummary {
  walletName: string;
  members: Member[];
  /** Sub-account holders in this wallet. SobreCard uses this both to
   *  keep the caller's card visible when they're a supplementary and to
   *  show THEIR balance (not the family total) on the summary card. */
  subaccounts: { address: string; balance: bigint }[];
  totalStroops: bigint;
  isClosed: boolean;
  /** True when the contract exists on chain but has no matching Supabase
   *  `family_wallets` row (typically an orphan from a create where the DB
   *  mirror failed). Consumers can hide these from the list. */
  isOrphan: boolean;
  /** True when the on-chain get_state simulation failed. The Supabase
   *  side of the summary is still populated so the list can render a real
   *  name; clicking through will hit the wallet dashboard's error branch. */
  chainFailed: boolean;
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
 * Reads the display name from Supabase (family_wallets.display_name), the
 * balances + members from on-chain get_state. Tolerates chain failures by
 * still returning a Supabase-only summary — an older wasm whose get_state
 * traps still renders as a card with its real name and a "chainFailed"
 * flag the dashboard can use to badge it.
 */
export function useSobreSummary(
  contractId: string,
  callerAddress: string | null,
): UseSobreSummaryResult {
  const [summary, setSummary] = useState<SobreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch-on-mount external-sync effect.
    if (!callerAddress) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
            .select("id, display_name")
            .eq("contract_id", contractId)
            .maybeSingle(),
        ]);
        if (cancelled) return;

        const familyRow =
          familySettled.status === "fulfilled" && !familySettled.value.error
            ? (familySettled.value.data as
                | { id: string; display_name: string | null }
                | null)
            : null;
        const supabaseName = familyRow?.display_name ?? null;
        const familyWalletId = familyRow?.id ?? null;

        let members: Member[] = [];
        let subaccounts: { address: string; balance: bigint }[] = [];
        let totalStroops = 0n;
        let chainWalletName = "";
        let chainFailed = false;
        if (rawSettled.status === "fulfilled") {
          const raw = rawSettled.value;
          const rawMembers = Array.isArray(raw.members)
            ? (raw.members as Record<string, unknown>[]).map((m) => ({
                address: String(m.address),
                onChainName: String(m.name ?? ""),
              }))
            : [];
          // Enrich each on-chain member with their Google display_name +
          // avatar_url from Supabase. Goes through `family_members` (not
          // `wallets` — that table's RLS only lets you see your own row),
          // joining wallets(avatar_url) as fallback when family_members
          // was written before avatar_url landed.
          let profileByAddress = new Map<
            string,
            { name: string | null; avatarUrl: string | null }
          >();
          if (familyWalletId && rawMembers.length > 0) {
            const { data: profileRows } = await supabase
              .from("family_members")
              .select("contract_id, name, avatar_url, wallets(avatar_url)")
              .eq("wallet_id", familyWalletId);
            profileByAddress = new Map(
              (profileRows ?? []).map((r) => {
                const walletsRow = Array.isArray(r.wallets)
                  ? r.wallets[0]
                  : r.wallets;
                return [
                  String(r.contract_id),
                  {
                    name: (r.name as string | null) ?? null,
                    avatarUrl:
                      (r.avatar_url as string | null) ??
                      (walletsRow?.avatar_url as string | null | undefined) ??
                      null,
                  },
                ];
              }),
            );
          }
          if (cancelled) return;
          members = rawMembers.map((m) => {
            const p = profileByAddress.get(m.address);
            return {
              address: m.address,
              name: p?.name || m.onChainName,
              avatarUrl: p?.avatarUrl ?? null,
              walletDbId: null,
              role: "recipient",
            };
          });
          subaccounts = Array.isArray(raw.subaccounts)
            ? (raw.subaccounts as Record<string, unknown>[]).map((s) => ({
                address: String(s.address),
                balance:
                  typeof s.balance === "bigint"
                    ? s.balance
                    : BigInt(String(s.balance ?? 0)),
              }))
            : [];
          const balances = (raw.balances as bigint[] | undefined) ?? [];
          totalStroops = balances.reduce((acc, b) => acc + b, 0n);
          chainWalletName = String(raw.wallet_name ?? "");
        } else {
          chainFailed = true;
          setError(
            rawSettled.reason instanceof Error
              ? rawSettled.reason.message
              : String(rawSettled.reason),
          );
        }

        setSummary({
          walletName: supabaseName || chainWalletName || "Family Wallet",
          members,
          subaccounts,
          totalStroops,
          isClosed: false,
          isOrphan: familyRow === null,
          chainFailed,
        });
        if (!chainFailed) setError(null);
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
