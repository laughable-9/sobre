"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SpendPolicyShape } from "@/lib/contract";
import { ENVELOPE_LABELS, type EnvelopeName } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { firstJoined } from "@/lib/supabase/utils";

export interface FamilyMemberDisplay {
  contractId: string;
  walletDbId: string;
  name: string;
  emoji: string;
  role: "admin" | "recipient";
}

export interface FamilyDisplayState {
  /** family_wallets.id (Supabase UUID). null while resolving. */
  familyWalletId: string | null;
  walletName: string;
  envelopeNames: [string, string, string];
  /** Per-envelope split percentages, indexed [Groceries, Tuition, Savings]. */
  percents: [number, number, number];
  /** Family-level spend policy. Defaults are "no gate, nobody protected". */
  policy: SpendPolicyShape;
  membersByAddress: Map<string, FamilyMemberDisplay>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_NAMES: [string, string, string] = [
  ENVELOPE_LABELS[0],
  ENVELOPE_LABELS[1],
  ENVELOPE_LABELS[2],
];
const DEFAULT_PERCENTS: [number, number, number] = [50, 30, 20];
const DEFAULT_POLICY: SpendPolicyShape = {
  requireAllSigs: false,
  dailyLimit: null,
  perTxThreshold: null,
  protectedEnvelopes: [],
};

interface FamilyRow {
  id: string;
  display_name: string | null;
  percents: number[] | null;
  policy_json: {
    require_all_sigs?: boolean;
    daily_limit_stroops?: string | number | null;
    per_tx_threshold_stroops?: string | number | null;
    protected_envelopes?: EnvelopeName[];
  } | null;
}

function normalizePolicy(raw: FamilyRow["policy_json"]): SpendPolicyShape {
  if (!raw) return DEFAULT_POLICY;
  const optBigint = (v: string | number | null | undefined) =>
    v === null || v === undefined ? null : BigInt(v);
  return {
    requireAllSigs: Boolean(raw.require_all_sigs),
    dailyLimit: optBigint(raw.daily_limit_stroops),
    perTxThreshold: optBigint(raw.per_tx_threshold_stroops),
    protectedEnvelopes: raw.protected_envelopes ?? [],
  };
}

function normalizePercents(raw: number[] | null): [number, number, number] {
  if (!raw || raw.length !== 3) return DEFAULT_PERCENTS;
  return [raw[0]!, raw[1]!, raw[2]!];
}

/**
 * Family-level Supabase state — wallet name, envelope display labels, split
 * percents, spend policy, and per-member display data (name/emoji/role).
 * The dashboard joins this with on-chain truth in useWalletState.
 */
export function useFamilyDisplay(
  contractId: string | null,
): FamilyDisplayState {
  const [familyWalletId, setFamilyWalletId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [envelopeNames, setEnvelopeNames] =
    useState<[string, string, string]>(DEFAULT_NAMES);
  const [percents, setPercents] =
    useState<[number, number, number]>(DEFAULT_PERCENTS);
  const [policy, setPolicy] = useState<SpendPolicyShape>(DEFAULT_POLICY);
  const [membersByAddress, setMembersByAddress] = useState<
    Map<string, FamilyMemberDisplay>
  >(new Map());
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    try {
      const { data: family } = await supabase
        .from("family_wallets")
        .select("id, display_name, percents, policy_json")
        .eq("contract_id", contractId)
        .maybeSingle();
      if (!family) {
        setFamilyWalletId(null);
        setWalletName("");
        setEnvelopeNames(DEFAULT_NAMES);
        setPercents(DEFAULT_PERCENTS);
        setPolicy(DEFAULT_POLICY);
        setMembersByAddress(new Map());
        return;
      }
      const row = family as FamilyRow;
      setFamilyWalletId(row.id);
      setWalletName(row.display_name ?? "");
      setPercents(normalizePercents(row.percents));
      setPolicy(normalizePolicy(row.policy_json));

      const [{ data: names }, { data: members }] = await Promise.all([
        supabase
          .from("family_envelope_names")
          .select("envelope_key, display_name")
          .eq("family_wallet_id", row.id),
        supabase
          .from("family_members")
          .select("wallet_id, role, name, emoji, wallets(contract_id)")
          .eq("family_wallet_id", row.id),
      ]);

      const nextNames: [string, string, string] = [...DEFAULT_NAMES];
      for (const n of (names as Array<{ envelope_key: string; display_name: string }> | null) ??
        []) {
        if (n.envelope_key === "Groceries") nextNames[0] = n.display_name;
        else if (n.envelope_key === "Tuition") nextNames[1] = n.display_name;
        else if (n.envelope_key === "Savings") nextNames[2] = n.display_name;
      }
      setEnvelopeNames(nextNames);

      const map = new Map<string, FamilyMemberDisplay>();
      type MemberRow = {
        wallet_id: string;
        role: "admin" | "recipient";
        name: string | null;
        emoji: string | null;
        wallets: { contract_id: string } | { contract_id: string }[] | null;
      };
      for (const m of (members as MemberRow[] | null) ?? []) {
        const wallets = firstJoined(m.wallets);
        if (!wallets?.contract_id) continue;
        map.set(wallets.contract_id, {
          contractId: wallets.contract_id,
          walletDbId: m.wallet_id,
          name: m.name ?? "",
          emoji: m.emoji ?? "",
          role: m.role,
        });
      }
      setMembersByAddress(map);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!contractId || !familyWalletId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`family-display:${familyWalletId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_wallets",
          filter: `id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_envelope_names",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_wallet_id=eq.${familyWalletId}`,
        },
        () => void fetchAll(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [contractId, familyWalletId, fetchAll]);

  return useMemo(
    () => ({
      familyWalletId,
      walletName,
      envelopeNames,
      percents,
      policy,
      membersByAddress,
      loading,
      refresh: fetchAll,
    }),
    [
      familyWalletId,
      walletName,
      envelopeNames,
      percents,
      policy,
      membersByAddress,
      loading,
      fetchAll,
    ],
  );
}
