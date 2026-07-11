"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";

import { NETWORK, type EnvelopeName } from "@/lib/config";
import { getServer, simulateSourceAccount, type SpendPolicyShape } from "@/lib/contract";
import { envelopeNameFromScNative } from "@/lib/format";
import { useFamilyDisplay } from "@/hooks/useFamilyDisplay";

export interface Member {
  address: string;
  name: string;
  emoji: string;
  /** Supabase `wallets.id` — handy when a downstream mutation needs to
   *  reference the member's row without a fresh contract_id → id lookup. */
  walletDbId: string | null;
  /** Family role from Supabase `family_members.role`. Defaults to
   *  "recipient" when no display row exists yet so a freshly-joined member
   *  doesn't accidentally count as an admin. */
  role: "admin" | "recipient";
}

export interface SubAccount {
  address: string;
  balance: bigint;
  locked: boolean;
}

export interface EarnPosition {
  envelope: EnvelopeName;
  /** Sobre's non-collateral supply position on the Blend pool, in bTokens.
   *  Constant absent supply/withdraw actions — yield accrues through b_rate,
   *  not by minting more shares. */
  bTokens: bigint;
  /** Live underlying-value snapshot at get_state time: bTokens × b_rate /
   *  SCALAR_12. Ticks up between polls as Blend accrues interest. */
  underlying: bigint;
  /** Monotonic cumulative underlying stroops ever supplied to Blend for
   *  this envelope. Doesn't decrease. */
  suppliedTotal: bigint;
  /** Monotonic cumulative underlying stroops ever withdrawn. Doesn't
   *  decrease. */
  withdrawnTotal: bigint;
  /** `underlying + withdrawnTotal - suppliedTotal`. The lifetime interest
   *  the envelope has accrued through Blend, honest across withdraw cycles. */
  interestEarned: bigint;
}

/** Grow's own Blend position — parallels EarnPosition but not envelope-
 *  tagged (Grow is its own bucket). Present in `EarnState.growPosition`
 *  as a 0-or-1 vec when Grow has supplied at least once. */
export interface GrowEarnPosition {
  bTokens: bigint;
  underlying: bigint;
  suppliedTotal: bigint;
  withdrawnTotal: bigint;
  interestEarned: bigint;
}

export interface EarnState {
  pool: string;
  asset: string;
  /** One entry per envelope with a non-zero position. Absent envelopes
   *  have zero. */
  positions: EarnPosition[];
  /** Grow's Blend position (0-or-1 element). Null when Grow has never
   *  supplied (either Grow disabled or Grow enabled with all funds in
   *  the cache). */
  growPosition: GrowEarnPosition | null;
}

export interface GrowWithdrawRequest {
  /** Monotonic id assigned by `request_grow_withdrawal`. Stable across
   *  polls; used to route `execute_grow_withdrawal` / `cancel_grow_withdrawal`. */
  id: bigint;
  /** The address that queued the request. Under the current single-admin
   *  model this equals `state.admin`; kept explicit so a future multi-admin
   *  refactor doesn't silently break the auth semantic. */
  requester: string;
  amount: bigint;
  /** Unix seconds. Compare with `Math.floor(Date.now() / 1000)` to derive
   *  the countdown; the contract's `execute_grow_withdrawal` traps until
   *  `env.ledger().timestamp() >= unlock_at`. */
  unlockAt: bigint;
}

export interface WalletState {
  admin: string;
  payment_token: string;
  /** Wallet display name (Supabase). */
  wallet_name: string;
  /** Envelope display labels (Supabase). */
  envelope_names: string[];
  /** Per-envelope split percentages (Supabase). Indexed [Groceries, Tuition, Savings]. */
  percents: [number, number, number];
  /** On-chain members. Joined with Supabase display data (name + emoji + walletDbId). */
  members: Member[];
  /** On-chain envelope balances in stroops. */
  balances: bigint[];
  /** On-chain sub-accounts. Empty when the contract predates the sub-account
   *  upgrade — the field is missing from the returned struct in that case,
   *  not present-as-empty. */
  subaccounts: SubAccount[];
  /** Family policy (Supabase). Frontend gates spends against this. */
  policy: SpendPolicyShape;
  /** Savings-envelope all-admins lock (Supabase). Routes Savings spends +
   *  sub-account funds to a pending request when on AND the family has more
   *  than one admin. */
  savings_lock_all_admins: boolean;
  /** Count of family_members with role='admin' for this family. Read live by
   *  the relay route at release-time; surfaced here for UI gating. */
  admin_count: number;
  /** Maximum admins allowed. Configurable per family (default 2). Used by
   *  the MembersSection to display "N of M admins" and by redeem_admin_invite
   *  to reject over-cap redemptions. */
  admin_cap: number;
  /** Null when the wallet hasn't opted into Blend Earn. Present when Earn
   *  is enabled — carries the pool + asset + per-envelope positions. Older
   *  contracts return no `earn` field on the wire and normalize to null. */
  earn: EarnState | null;
  /** True once admin has opted into the Grow bucket. Absent on pre-upgrade
   *  contracts and normalizes to false. */
  grow_enabled: boolean;
  /** Grow-bucket balance in stroops. Zero when disabled or empty. */
  grow_balance: bigint;
  /** Pending grow-withdraw requests. Empty when none active. */
  grow_requests: GrowWithdrawRequest[];
}

export interface UseWalletStateResult {
  state: WalletState | null;
  loading: boolean;
  /** Last chain-side error (`get_state` simulate). */
  error: string | null;
  /** Last Supabase-side error from useFamilyDisplay. When non-null the
   *  cosmetic + policy + percents fall back to defaults, so callers that
   *  flow into a money-moving action (deposits, spends) should refuse to
   *  proceed until it clears. */
  familyError: string | null;
  familyWalletId: string | null;
  refresh: () => Promise<void>;
  /** Re-fetches the Supabase-side family display only — no on-chain
   *  simulate. Prefer this when the change is off-chain (envelope names,
   *  split percents, admin_cap, spend policy) so the ~200-400ms Soroban
   *  RPC round-trip isn't spent for nothing. */
  refreshDisplay: () => Promise<void>;
}

interface OnChainState {
  admin: string;
  payment_token: string;
  members: { address: string }[];
  balances: bigint[];
  subaccounts: SubAccount[];
  earn: EarnState | null;
  grow_enabled: boolean;
  grow_balance: bigint;
  grow_requests: GrowWithdrawRequest[];
}

/**
 * Polls the contract's `get_state` for the on-chain truth (admin, members'
 * addresses, balances) and joins it with the Supabase-resident display +
 * family-rule state from useFamilyDisplay (wallet name, envelope labels,
 * percents, policy, member name/emoji).
 */
export function useWalletState(
  userAddress: string | null,
  contractId: string | null,
): UseWalletStateResult {
  const [onChain, setOnChain] = useState<OnChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const lastRetvalXdrRef = useRef<string | null>(null);
  const lastLedgerRef = useRef<number>(0);

  const display = useFamilyDisplay(contractId);
  const displayRefresh = display.refresh;

  const fetchState = useCallback(async () => {
    if (!userAddress || !contractId) return;
    const gen = ++generationRef.current;
    const server = getServer();

    const isInitialFetch = lastRetvalXdrRef.current === null;
    if (isInitialFetch) setLoading(true);
    try {
      const source = simulateSourceAccount();
      const contract = new Contract(contractId);
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK.passphrase,
      })
        .addOperation(contract.call("get_state"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (gen !== generationRef.current) return;
      if ("error" in sim) throw new Error(`simulation failed: ${sim.error}`);
      if (!sim.result?.retval) throw new Error("simulation returned no value");

      const simLedger = Number(sim.latestLedger ?? 0);
      if (simLedger > 0 && simLedger < lastLedgerRef.current) return;

      const retvalXdr = sim.result.retval.toXDR("base64");
      if (retvalXdr === lastRetvalXdrRef.current) return;

      lastRetvalXdrRef.current = retvalXdr;
      lastLedgerRef.current = Math.max(lastLedgerRef.current, simLedger);
      const raw = scValToNative(sim.result.retval) as Record<string, unknown>;
      setOnChain(normalizeOnChainState(raw));
      setError(null);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generationRef.current && isInitialFetch) setLoading(false);
    }
  }, [userAddress, contractId]);

  useEffect(() => {
    lastRetvalXdrRef.current = null;
    lastLedgerRef.current = 0;
    setOnChain(null);
    setError(null);
  }, [contractId]);

  useEffect(() => {
    if (!userAddress || !contractId) return;
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [userAddress, contractId, fetchState]);

  const state = useMemo<WalletState | null>(() => {
    if (!onChain) return null;
    let adminCount = 0;
    const members: Member[] = onChain.members.map((m) => {
      const d = display.membersByAddress.get(m.address);
      const role = d?.role ?? "recipient";
      if (role === "admin") adminCount += 1;
      return {
        address: m.address,
        name: d?.name ?? "",
        emoji: d?.emoji ?? "",
        walletDbId: d?.walletDbId ?? null,
        role,
      };
    });
    return {
      admin: onChain.admin,
      payment_token: onChain.payment_token,
      wallet_name: display.walletName,
      envelope_names: display.envelopeNames,
      percents: display.percents,
      members,
      balances: onChain.balances,
      subaccounts: onChain.subaccounts,
      policy: display.policy,
      savings_lock_all_admins: display.savingsLockAllAdmins,
      admin_count: adminCount,
      admin_cap: display.adminCap,
      earn: onChain.earn,
      grow_enabled: onChain.grow_enabled,
      grow_balance: onChain.grow_balance,
      grow_requests: onChain.grow_requests,
    };
  }, [
    onChain,
    display.walletName,
    display.envelopeNames,
    display.percents,
    display.policy,
    display.savingsLockAllAdmins,
    display.adminCap,
    display.membersByAddress,
  ]);

  const refresh = useCallback(async () => {
    await fetchState();
    await displayRefresh();
  }, [fetchState, displayRefresh]);

  return {
    state,
    loading,
    error,
    familyError: display.loadError,
    familyWalletId: display.familyWalletId,
    refresh,
    refreshDisplay: display.refresh,
  };
}

function normalizeOnChainState(raw: Record<string, unknown>): OnChainState {
  const members: { address: string }[] = Array.isArray(raw.members)
    ? (raw.members as Record<string, unknown>[]).map((m) => ({
        address: String(m.address),
      }))
    : [];
  // `subaccounts` is missing from contracts deployed before the upgrade;
  // treat as empty so the rest of the dashboard still renders.
  const subaccounts: SubAccount[] = Array.isArray(raw.subaccounts)
    ? (raw.subaccounts as Record<string, unknown>[]).map((s) => ({
        address: String(s.address),
        balance: typeof s.balance === "bigint" ? s.balance : BigInt(String(s.balance ?? 0)),
        locked: Boolean(s.locked),
      }))
    : [];
  return {
    admin: String(raw.admin),
    payment_token: String(raw.payment_token),
    members,
    balances: (raw.balances as bigint[]) ?? [],
    subaccounts,
    earn: normalizeEarnState(raw.earn),
    grow_enabled: Boolean(raw.grow_enabled),
    grow_balance: toBigInt(raw.grow_balance),
    grow_requests: normalizeGrowRequests(raw.grow_requests),
  };
}

/** Grow-request rows come across as `[{ id, requester, amount, unlock_at }]`.
 *  u64 ids and unlock_at land as bigint via scValToNative. */
function normalizeGrowRequests(raw: unknown): GrowWithdrawRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: toBigInt(row.id),
      requester: String(row.requester ?? ""),
      amount: toBigInt(row.amount),
      unlockAt: toBigInt(row.unlock_at),
    };
  });
}

/**
 * Contract wire shape is `Vec<EarnState>` (0- or 1-element) because
 * contracttype doesn't derive Option XDR for our own structs in SDK 25.
 * Empty vec (or missing field on a pre-upgrade contract) → null.
 * One-element vec → the EarnState, with per-envelope positions decoded.
 * `envelope` inside each position is a Soroban enum unit variant — decoded
 * by `scValToNative` as `["Groceries"]`-style single-element array.
 */
function normalizeEarnState(raw: unknown): EarnState | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const outer = raw[0] as Record<string, unknown>;
  const positionsRaw = Array.isArray(outer.positions) ? outer.positions : [];
  const positions: EarnPosition[] = positionsRaw.map((p) => {
    const row = p as Record<string, unknown>;
    return {
      envelope: envelopeNameFromScNative(row.envelope, "Groceries"),
      bTokens: toBigInt(row.b_tokens),
      underlying: toBigInt(row.underlying),
      suppliedTotal: toBigInt(row.supplied_total),
      withdrawnTotal: toBigInt(row.withdrawn_total),
      interestEarned: toBigInt(row.interest_earned),
    };
  });
  const growRaw = Array.isArray(outer.grow_position) ? outer.grow_position : [];
  const growPosition: GrowEarnPosition | null =
    growRaw.length > 0
      ? {
          bTokens: toBigInt((growRaw[0] as Record<string, unknown>).b_tokens),
          underlying: toBigInt(
            (growRaw[0] as Record<string, unknown>).underlying,
          ),
          suppliedTotal: toBigInt(
            (growRaw[0] as Record<string, unknown>).supplied_total,
          ),
          withdrawnTotal: toBigInt(
            (growRaw[0] as Record<string, unknown>).withdrawn_total,
          ),
          interestEarned: toBigInt(
            (growRaw[0] as Record<string, unknown>).interest_earned,
          ),
        }
      : null;
  return {
    pool: String(outer.pool ?? ""),
    asset: String(outer.asset ?? ""),
    positions,
    growPosition,
  };
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (v === null || v === undefined) return 0n;
  return BigInt(String(v));
}
