/**
 * GET /api/admin/metrics
 *
 * Platform-wide aggregate metrics for the internal /admin/metrics dashboard.
 * Gated to PLATFORM_ADMIN_EMAILS via requirePlatformAdmin — never exposed
 * to regular family users.
 *
 * Sobres/users come from the Supabase mirror (cheap, exact, all-time). TVL
 * comes from a live get_state read per Sobre (cheap — one simulate call
 * each, run with bounded concurrency); it sums envelope caches + Earn
 * (USDY) positions + sub-account balances + Grow, mirroring the same
 * accounting `lib/walletTotals.ts` uses client-side plus sub-accounts,
 * which the client total deliberately excludes (money already allocated to
 * a supplementary holder) but a platform-wide "money actually custodied"
 * figure should include. Transaction volume/count come from getEvents
 * scanned from `sinceLedger` to tip — RPC nodes only retain a bounded
 * ledger window (same ~100k-ledger / ~7-day window useTxFeed's backfill
 * uses), so those two numbers are "recent", not all-time; the UI labels
 * them accordingly rather than claiming a false total.
 *
 * Supports `?refresh=1` to force a recompute past the 60s cache — wired to
 * the dashboard's manual refresh button.
 */

import { NextRequest, NextResponse } from "next/server";
import { rpc } from "@stellar/stellar-sdk";

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin";
import { NETWORK, STROOPS_PER_USDC } from "@/lib/config";
import {
  getActivityWithPriorPeriodServer,
  simulateReadServer,
  toBigIntSafe,
} from "@/lib/contractServer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Same lookback used by useTxFeed's backfill — the practical ceiling for
 *  what a public Soroban RPC node still has indexed. */
const ACTIVITY_LOOKBACK_LEDGERS = 100_000;

/** Cap on simultaneous get_state / getEvents calls so a growing Sobre count
 *  can't fan out into an RPC rate-limit wall. */
const CONCURRENCY = 8;

interface RawEarnPosition {
  current_value?: bigint;
}
interface RawEarnState {
  positions?: RawEarnPosition[];
}
interface RawState {
  balances?: bigint[];
  subaccounts?: { balance: bigint }[];
  grow_balance?: bigint;
  earn?: RawEarnState[];
}

interface AdminMetrics {
  sobresCount: number;
  usersCount: number;
  tvlUsdc: number;
  avgSobreUsdc: number;
  /** Middle value of all per-Sobre balances. Reported alongside the mean
   *  because one large family can badly skew the average at this Sobre
   *  count — e.g. 18 Sobres, one whale — and a stakeholder reading "avg
   *  balance" alone would draw the wrong conclusion about a typical Sobre. */
  medianSobreUsdc: number;
  /** Sobres created before the activity window started that had at least
   *  one money-movement event during it — true retention, not just "count
   *  active right now" (which would also count same-week signups and
   *  overstate how many *existing* Sobres keep coming back). Null when no
   *  Sobre is old enough yet to measure. */
  retentionRate: number | null;
  retainedCount: number;
  matureSobresCount: number;
  activeSobresCount: number;
  /** Active Sobres in the prior window of equal length — lets the UI show
   *  whether engagement is trending up or down, not just today's snapshot. */
  activeSobresPrevCount: number;
  activeSobresDeltaPct: number | null;
  recentTxCount: number;
  recentTxCountDeltaPct: number | null;
  recentInflowUsdc: number;
  recentInflowDeltaPct: number | null;
  recentOutflowUsdc: number;
  recentOutflowDeltaPct: number | null;
  /** False when the prior-period comparison couldn't actually be computed
   *  (almost always the doubled ledger window exceeding RPC retention) and
   *  every *DeltaPct field above is null as a result. The UI must not
   *  render those as "new" — that implies a known-empty prior period, when
   *  really we just couldn't look back far enough to know. */
  activityPriorPeriodAvailable: boolean;
  /** recentInflowUsdc - recentOutflowUsdc for the same window — is the
   *  platform net-accumulating or net-draining money right now. */
  netFlowUsdc: number;
  activityWindowLedgers: number;
  /** Sobres created in the most recent activity window vs the window
   *  immediately before it — signup growth, not just a point-in-time
   *  total. Null delta when the prior window had zero (percentage growth
   *  off a zero base is undefined, not "infinite%"). */
  sobresCreatedThisPeriod: number;
  sobresCreatedPrevPeriod: number;
  sobresCreatedDeltaPct: number | null;
  sobresCreatedByDay: { day: string; count: number }[];
  computedAt: string;
}

let cache: { data: AdminMetrics; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Everything the contract actually custodies for this Sobre: envelope
 *  caches, Earn (USDY) positions on top of them, sub-account ledger
 *  balances, and Grow. Missing any of these silently understates TVL by
 *  whatever's parked there. */
function walletTotalStroops(state: RawState | null): bigint {
  if (!state) return 0n;
  let total = 0n;
  for (const b of state.balances ?? []) total += toBigIntSafe(b);
  for (const s of state.subaccounts ?? []) total += toBigIntSafe(s.balance);
  for (const earnState of state.earn ?? []) {
    for (const p of earnState.positions ?? []) {
      total += toBigIntSafe(p.current_value);
    }
  }
  total += toBigIntSafe(state.grow_balance);
  return total;
}

/** Percent change vs. a prior value. Null when the prior value was zero —
 *  percentage growth off a zero base is undefined, not "infinite%". */
function deltaPct(current: number, prior: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}

/** Middle value of a sorted numeric list; 0 for an empty list. Average
 *  alone hides skew from a single outsized value, which matters at low N. */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Every calendar day from the first-ever Sobre to today (oldest first),
 *  each with its actual signup count — zero-filled so gaps render as flat
 *  bars instead of silently disappearing and compressing the x-axis.
 *
 * Deliberately uncapped rather than "last 90 days": it's the same single
 * Supabase query either way (this just widens the JS loop that buckets the
 * rows already fetched), the client already re-buckets this into
 * Day/Week/Month views, and the chart itself scrolls — so there's no
 * reason to throw away history the product will have a year from now.
 * Empty when there are no Sobres yet. */
function buildDailySeries(
  wallets: { created_at: string }[],
): { day: string; count: number }[] {
  if (wallets.length === 0) return [];
  const byDay = new Map<string, number>();
  for (const w of wallets) {
    const day = w.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  // `wallets` is ordered by created_at ascending (see the query below).
  const firstDay = new Date(`${wallets[0].created_at.slice(0, 10)}T00:00:00Z`);
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const totalDays =
    Math.round((todayUtc.getTime() - firstDay.getTime()) / 86_400_000) + 1;

  const series: { day: string; count: number }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(firstDay);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return series;
}

async function computeMetrics(): Promise<AdminMetrics> {
  const admin = getSupabaseAdmin();
  const [walletsRes, membersRes] = await Promise.all([
    admin
      .from("family_wallets")
      .select("contract_id, created_at")
      .order("created_at", { ascending: true }),
    admin.from("family_members").select("wallet_id"),
  ]);

  const wallets =
    (walletsRes.data as { contract_id: string; created_at: string }[]) ?? [];
  const members = (membersRes.data as { wallet_id: string }[]) ?? [];

  const sobresCount = wallets.length;
  const usersCount = new Set(members.map((m) => m.wallet_id)).size;
  const sobresCreatedByDay = buildDailySeries(wallets);

  const server = new rpc.Server(NETWORK.rpcUrl);
  const latest = await server.getLatestLedger();
  const sinceLedger = Math.max(latest.sequence - ACTIVITY_LOOKBACK_LEDGERS, 1);
  const priorSinceLedger = Math.max(
    latest.sequence - 2 * ACTIVITY_LOOKBACK_LEDGERS,
    1,
  );
  // Approximate wall-clock start of the activity window, from Stellar's
  // ~5s ledger close time — same conversion the UI uses to label the
  // window ("last ~N days"). Used only to bucket Sobres into "existed
  // before this window" vs "brand new"; a few hours of drift doesn't
  // change which bucket a Sobre created weeks apart falls into.
  const windowDays = Math.round(ACTIVITY_LOOKBACK_LEDGERS / 17_280);
  const windowStart = new Date(Date.now() - windowDays * 86_400_000);
  const prevWindowStart = new Date(
    windowStart.getTime() - windowDays * 86_400_000,
  );

  const contractIds = wallets.map((w) => w.contract_id);

  const [states, activityResult] = await Promise.all([
    mapWithConcurrency(contractIds, CONCURRENCY, (id) =>
      simulateReadServer<RawState>(id, "get_state"),
    ),
    getActivityWithPriorPeriodServer(contractIds, sinceLedger, priorSinceLedger),
  ]);
  const { activities: activityByContract, priorPeriodAvailable } = activityResult;

  const walletTotalsStroops = states.map(walletTotalStroops);
  const tvlStroops = walletTotalsStroops.reduce((sum, s) => sum + s, 0n);
  const sortedUsdc = walletTotalsStroops
    .map((s) => Number(s) / STROOPS_PER_USDC)
    .sort((a, b) => a - b);

  const activity = Array.from(activityByContract.values());
  const recentTxCount = activity.reduce((sum, a) => sum + a.current.count, 0);
  const recentInflowStroops = activity.reduce(
    (sum, a) => sum + a.current.inflowStroops,
    0n,
  );
  const recentOutflowStroops = activity.reduce(
    (sum, a) => sum + a.current.outflowStroops,
    0n,
  );
  const activeSobresCount = activity.filter((a) => a.current.count > 0).length;

  const prevTxCount = activity.reduce((sum, a) => sum + a.prior.count, 0);
  const prevInflowStroops = activity.reduce(
    (sum, a) => sum + a.prior.inflowStroops,
    0n,
  );
  const prevOutflowStroops = activity.reduce(
    (sum, a) => sum + a.prior.outflowStroops,
    0n,
  );
  const activeSobresPrevCount = activity.filter((a) => a.prior.count > 0).length;

  // Retention: of the Sobres that already existed before the activity
  // window opened (excludes this week's/month's own signups, which
  // haven't had a chance to churn yet), how many were still active during
  // it.
  const matureIds = wallets
    .filter((w) => new Date(w.created_at) < windowStart)
    .map((w) => w.contract_id);
  const retainedCount = matureIds.filter(
    (id) => (activityByContract.get(id)?.current.count ?? 0) > 0,
  ).length;
  const matureSobresCount = matureIds.length;

  const sobresCreatedThisPeriod = wallets.filter(
    (w) => new Date(w.created_at) >= windowStart,
  ).length;
  const sobresCreatedPrevPeriod = wallets.filter((w) => {
    const t = new Date(w.created_at);
    return t >= prevWindowStart && t < windowStart;
  }).length;

  const tvlUsdc = Number(tvlStroops) / STROOPS_PER_USDC;

  return {
    sobresCount,
    usersCount,
    tvlUsdc,
    avgSobreUsdc: sobresCount > 0 ? tvlUsdc / sobresCount : 0,
    medianSobreUsdc: median(sortedUsdc),
    retentionRate: matureSobresCount > 0 ? retainedCount / matureSobresCount : null,
    retainedCount,
    matureSobresCount,
    activeSobresCount,
    activeSobresPrevCount,
    activeSobresDeltaPct: priorPeriodAvailable
      ? deltaPct(activeSobresCount, activeSobresPrevCount)
      : null,
    recentTxCount,
    recentTxCountDeltaPct: priorPeriodAvailable
      ? deltaPct(recentTxCount, prevTxCount)
      : null,
    recentInflowUsdc: Number(recentInflowStroops) / STROOPS_PER_USDC,
    recentInflowDeltaPct: priorPeriodAvailable
      ? deltaPct(Number(recentInflowStroops), Number(prevInflowStroops))
      : null,
    recentOutflowUsdc: Number(recentOutflowStroops) / STROOPS_PER_USDC,
    recentOutflowDeltaPct: priorPeriodAvailable
      ? deltaPct(Number(recentOutflowStroops), Number(prevOutflowStroops))
      : null,
    activityPriorPeriodAvailable: priorPeriodAvailable,
    netFlowUsdc:
      Number(recentInflowStroops - recentOutflowStroops) / STROOPS_PER_USDC,
    activityWindowLedgers: ACTIVITY_LOOKBACK_LEDGERS,
    sobresCreatedThisPeriod,
    sobresCreatedPrevPeriod,
    sobresCreatedDeltaPct: deltaPct(sobresCreatedThisPeriod, sobresCreatedPrevPeriod),
    sobresCreatedByDay,
    computedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await requirePlatformAdmin();
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data);
  }

  try {
    const data = await computeMetrics();
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Failed to compute metrics: ${msg}` },
      { status: 500 },
    );
  }
}
