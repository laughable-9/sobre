"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SpendPolicyShape } from "@/lib/contract";
import { ENVELOPE_LABELS, type EnvelopeName } from "@/lib/config";
import { DEFAULT_ICON_KEY_BY_SLOT } from "@/lib/envelopeIcons";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { firstJoined } from "@/lib/supabase/utils";

export interface FamilyMemberDisplay {
  contractId: string;
  walletDbId: string;
  name: string;
  /** Google profile picture URL (populated on OAuth sign-in). Null when the
   *  member hasn't signed in yet or their Google account has no picture. */
  avatarUrl: string | null;
  role: "admin" | "recipient";
}

export interface FamilyDisplayState {
  /** family_wallets.id (Supabase UUID). null while resolving. */
  familyWalletId: string | null;
  walletName: string;
  envelopeNames: [string, string, string];
  /** Per-envelope icon key (see lib/envelopeIcons.tsx). Null means the
   *  family hasn't customised that slot; UI falls back to the slot default. */
  envelopeIcons: [string, string, string];
  /** Per-envelope split percentages, indexed [Groceries, Tuition, Savings]. */
  percents: [number, number, number];
  /** Family-level spend policy. Defaults are "no gate, nobody protected". */
  policy: SpendPolicyShape;
  /** When true, money leaving Savings needs every admin's approval. Read fresh
   *  at release-time so adding/removing admins re-thresholds in flight. */
  savingsLockAllAdmins: boolean;
  /** Maximum number of family_members with role='admin' allowed on this
   *  family. Configurable per family (default 2 for the OFW-couple model);
   *  enforced by the redeem_admin_invite RPC when an invitee tries to
   *  promote to admin. */
  adminCap: number;
  membersByAddress: Map<string, FamilyMemberDisplay>;
  loading: boolean;
  /** Non-null when the latest Supabase fetch errored. Consumers can read
   *  this through `useWalletState` to refuse renders that would otherwise
   *  show defaults (e.g. deposit modal splitting against stale percents). */
  loadError: string | null;
  refresh: () => Promise<void>;
}

const DEFAULT_NAMES: [string, string, string] = [
  ENVELOPE_LABELS[0],
  ENVELOPE_LABELS[1],
  ENVELOPE_LABELS[2],
];
const DEFAULT_ICONS: [string, string, string] = [
  DEFAULT_ICON_KEY_BY_SLOT[ENVELOPE_LABELS[0]],
  DEFAULT_ICON_KEY_BY_SLOT[ENVELOPE_LABELS[1]],
  DEFAULT_ICON_KEY_BY_SLOT[ENVELOPE_LABELS[2]],
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
  savings_lock_all_admins: boolean | null;
  admin_cap: number | null;
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
 * percents, spend policy, and per-member display data (name/avatar/role).
 * The dashboard joins this with on-chain truth in useWalletState.
 */
export function useFamilyDisplay(
  contractId: string | null,
): FamilyDisplayState {
  const [familyWalletId, setFamilyWalletId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [envelopeNames, setEnvelopeNames] =
    useState<[string, string, string]>(DEFAULT_NAMES);
  const [envelopeIcons, setEnvelopeIcons] =
    useState<[string, string, string]>(DEFAULT_ICONS);
  const [percents, setPercents] =
    useState<[number, number, number]>(DEFAULT_PERCENTS);
  const [policy, setPolicy] = useState<SpendPolicyShape>(DEFAULT_POLICY);
  const [savingsLockAllAdmins, setSavingsLockAllAdmins] = useState(false);
  const [adminCap, setAdminCap] = useState<number>(2);
  const [membersByAddress, setMembersByAddress] = useState<
    Map<string, FamilyMemberDisplay>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    // Surface every read error to the dashboard rather than falling
    // through to defaults. DEFAULT_PERCENTS [50,30,20] + an open policy
    // would split the next deposit by the wrong percentages, which is a
    // real money-routing bug.
    const fail = (label: string, err: { message: string }) => {
      setLoadError(`Couldn't load ${label}: ${err.message}`);
    };
    try {
      const { data: family, error: familyErr } = await supabase
        .from("family_wallets")
        .select(
          "id, display_name, percents, policy_json, savings_lock_all_admins, admin_cap",
        )
        .eq("contract_id", contractId)
        .maybeSingle();
      if (familyErr) {
        fail("family settings", familyErr);
        return;
      }
      if (!family) {
        setLoadError(null);
        setFamilyWalletId(null);
        setWalletName("");
        setEnvelopeNames(DEFAULT_NAMES);
        setEnvelopeIcons(DEFAULT_ICONS);
        setPercents(DEFAULT_PERCENTS);
        setPolicy(DEFAULT_POLICY);
        setSavingsLockAllAdmins(false);
        setAdminCap(2);
        setMembersByAddress(new Map());
        return;
      }
      const row = family as FamilyRow;

      const [namesQ, membersQ] = await Promise.all([
        supabase
          .from("family_envelope_names")
          .select("envelope_key, display_name, icon")
          .eq("family_wallet_id", row.id),
        supabase
          .from("family_members")
          .select(
            "wallet_id, role, name, wallets(contract_id, avatar_url)",
          )
          .eq("family_wallet_id", row.id),
      ]);
      if (namesQ.error) {
        fail("envelope labels", namesQ.error);
        return;
      }
      if (membersQ.error) {
        fail("family members", membersQ.error);
        return;
      }

      // Only commit state once every read succeeded, so a partial failure
      // doesn't leave the dashboard mid-stale.
      setLoadError(null);
      setFamilyWalletId(row.id);
      setWalletName(row.display_name ?? "");
      setPercents(normalizePercents(row.percents));
      setPolicy(normalizePolicy(row.policy_json));
      setSavingsLockAllAdmins(Boolean(row.savings_lock_all_admins));
      setAdminCap(
        typeof row.admin_cap === "number" && row.admin_cap >= 1
          ? row.admin_cap
          : 2,
      );

      const nextNames: [string, string, string] = [...DEFAULT_NAMES];
      const nextIcons: [string, string, string] = [...DEFAULT_ICONS];
      const slotFor = (key: string): 0 | 1 | 2 | null =>
        key === "Groceries" ? 0 :
        key === "Tuition" ? 1 :
        key === "Savings" ? 2 :
        null;
      for (const n of (namesQ.data as Array<{
        envelope_key: string;
        display_name: string;
        icon: string | null;
      }> | null) ?? []) {
        const slot = slotFor(n.envelope_key);
        if (slot === null) continue;
        nextNames[slot] = n.display_name;
        if (n.icon) nextIcons[slot] = n.icon;
      }
      setEnvelopeNames(nextNames);
      setEnvelopeIcons(nextIcons);

      const map = new Map<string, FamilyMemberDisplay>();
      type WalletJoined = { contract_id: string; avatar_url: string | null };
      type MemberRow = {
        wallet_id: string;
        role: "admin" | "recipient";
        name: string | null;
        wallets: WalletJoined | WalletJoined[] | null;
      };
      for (const m of (membersQ.data as MemberRow[] | null) ?? []) {
        const wallets = firstJoined(m.wallets);
        if (!wallets?.contract_id) continue;
        map.set(wallets.contract_id, {
          contractId: wallets.contract_id,
          walletDbId: m.wallet_id,
          name: m.name ?? "",
          avatarUrl: wallets.avatar_url ?? null,
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
      envelopeIcons,
      percents,
      policy,
      savingsLockAllAdmins,
      adminCap,
      membersByAddress,
      loading,
      loadError,
      refresh: fetchAll,
    }),
    [
      familyWalletId,
      walletName,
      envelopeNames,
      envelopeIcons,
      percents,
      policy,
      savingsLockAllAdmins,
      adminCap,
      membersByAddress,
      loading,
      loadError,
      fetchAll,
    ],
  );
}
