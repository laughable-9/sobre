/**
 * Server-side Soroban read helpers. Mirrors the read-only half of
 * `lib/contract.ts` (which is "use client") so route handlers can
 * simulateTransaction without dragging in browser-only deps.
 *
 * The `rpc.Server` is module-scope so Vercel's warm container reuses the
 * underlying HTTPS agent + keep-alive socket pool across invocations
 * (~50-150ms TLS handshake saved on the second + N-th simulate per cold
 * container).
 */

import "server-only";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { NETWORK, SOROSWAP_ROUTER_ID } from "@/lib/config";

// Stub source account for read-only simulations. simulateTransaction
// doesn't care about source sequence/signature, so any well-formed G
// address works. We use the passkey-kit deployer's well-known address.
const SIM_SOURCE = "GAVMWNSJ7QKWTXWS3TRQ6JHTEAGKTHZTDG6RKQUPUQGXKGCMEEYWWWA2";

const sharedServer = new rpc.Server(NETWORK.rpcUrl);

/**
 * Call a Soroban contract's read-only method server-side and return its
 * native decoded value. Returns `null` on contract-not-found, simulate
 * error, or empty retval (caller decides whether that's a 404 or a 500).
 */
export async function simulateReadServer<T>(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<T | null> {
  try {
    const source = new Account(SIM_SOURCE, "0");
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.passphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await sharedServer.simulateTransaction(tx);
    if ("error" in sim) return null;
    const retval = sim.result?.retval;
    if (!retval) return null;
    return scValToNative(retval) as T;
  } catch {
    return null;
  }
}

/**
 * Quote the Soroswap router: how much `toSacId` comes out for `amountIn`
 * of `fromSacId`. Shared by the effective-rate price route (USDC → XLM)
 * and the deposit pipeline's credited-amount fallback (XLM → USDC).
 * Returns null on any simulate failure or non-positive quote.
 */
export async function soroswapAmountOut(
  fromSacId: string,
  toSacId: string,
  amountIn: bigint,
): Promise<bigint | null> {
  const amounts = await simulateReadServer<bigint[]>(
    SOROSWAP_ROUTER_ID,
    "router_get_amounts_out",
    [
      nativeToScVal(amountIn, { type: "i128" }),
      xdr.ScVal.scvVec([
        Address.fromString(fromSacId).toScVal(),
        Address.fromString(toSacId).toScVal(),
      ]),
    ],
  );
  const out = amounts?.[amounts.length - 1];
  return typeof out === "bigint" && out > 0n ? out : null;
}

/** Delay schedule (ms between attempts) for a Soroban read that races the
 *  RPC pool's async indexing. The client polled its own tx to SUCCESS on
 *  one backend, but our server-side simulate can land on a lagging replica.
 *  ~6.2s total budget across 4 waits — well under the wall clock the user
 *  already spent on FaceID prompts. Front-loaded (300ms first) because the
 *  common lag is short and a fat first wait is dead time. */
export const RPC_INDEXER_LAG_BACKOFF = [300, 900, 2000, 3000] as const;

/**
 * Retry {@link simulateReadServer} until `ready` returns true or the delay
 * schedule runs out. Returns the last-read value regardless — callers
 * decide whether "not ready after N attempts" is a 404 or a 500.
 *
 * When the caller already ran the first attempt (typically raced with a
 * rate-limit check so the happy path pays zero extra latency), pass it as
 * `initial` — a passing initial short-circuits the whole retry loop.
 */
export async function simulateReadServerRetry<T>(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
  opts?: {
    /** Predicate for "the RPC has caught up." Default: any non-null value. */
    ready?: (value: T | null) => boolean;
    /** Wait schedule between attempts, in ms. Default: RPC_INDEXER_LAG_BACKOFF. */
    delaysMs?: readonly number[];
    /** Skip the first attempt if it already ran outside this helper. */
    initial?: T | null;
  },
): Promise<T | null> {
  const ready = opts?.ready ?? ((v: T | null) => v !== null);
  const delays = opts?.delaysMs ?? RPC_INDEXER_LAG_BACKOFF;
  let value =
    opts?.initial !== undefined
      ? opts.initial
      : await simulateReadServer<T>(contractId, method, args);
  if (ready(value)) return value;
  for (const delayMs of delays) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    value = await simulateReadServer<T>(contractId, method, args);
    if (ready(value)) return value;
  }
  return value;
}

/** Event kinds whose `amount` represents money moving INTO a Sobre. */
const INFLOW_EVENT_KINDS = new Set(["deposit", "sub_account_funded"]);
/** Event kinds whose `amount` represents money moving OUT of a Sobre.
 *  Excludes internal bookkeeping (Earn/Grow supply-withdraw, request
 *  lifecycle) which doesn't represent user-facing transaction volume. */
const OUTFLOW_EVENT_KINDS = new Set(["withdraw", "sub_account_withdraw"]);

/** Soroban RPC's getEvents caps each filter at 5 contractIds and a request
 *  at 5 filters — so one call covers up to 25 contracts. */
const CONTRACT_IDS_PER_FILTER = 5;
const FILTERS_PER_REQUEST = 5;
const CONTRACTS_PER_BATCH = CONTRACT_IDS_PER_FILTER * FILTERS_PER_REQUEST;

/** get_state numeric fields don't always decode as `bigint` (same gap
 *  `toBigInt` patches client-side in useWalletState.ts) — normalize before
 *  any `+`/`+=` against another bigint, or V8 throws "Cannot mix BigInt
 *  and other types". */
export function toBigIntSafe(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (v === null || v === undefined) return 0n;
  return BigInt(String(v));
}

export interface ContractActivity {
  count: number;
  inflowStroops: bigint;
  outflowStroops: bigint;
}

function emptyActivity(): ContractActivity {
  return { count: 0, inflowStroops: 0n, outflowStroops: 0n };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface ActivityWithPriorPeriodResult {
  activities: Map<string, { current: ContractActivity; prior: ContractActivity }>;
  /** False when at least one batch couldn't reach back to `priorWindowLedger`
   *  (almost always RPC retention) and fell back to a current-period-only
   *  scan. Callers should treat every `prior` value as "no comparable data",
   *  not "genuinely zero" — the difference matters: showing a 0% or "new"
   *  delta implies we know the prior period was empty, when actually we
   *  just couldn't look that far back. */
  priorPeriodAvailable: boolean;
}

/**
 * Sum transaction count + in/out volume (token stroops) per contract, split
 * into the current period (`currentWindowLedger` to tip) and the prior
 * period of equal length before it (`priorWindowLedger` to
 * `currentWindowLedger`) — one `getEvents` scan of the combined window
 * rather than two separate scans, so a "vs last period" trend costs nothing
 * extra over the single-period version. Events are bucketed by `ev.ledger`
 * against `currentWindowLedger`.
 *
 * Batches contractIds into as few getEvents calls as the RPC's filter
 * limits allow (25 contracts/call) instead of one call per contract, and
 * attributes each event back to its contract via `ev.contractId`.
 * Best-effort: a retention error or RPC failure on one batch leaves that
 * batch's contracts zeroed rather than throwing, since this feeds an
 * aggregate dashboard where one bad batch shouldn't blank the whole page.
 */
export async function getActivityWithPriorPeriodServer(
  contractIds: string[],
  currentWindowLedger: number,
  priorWindowLedger: number,
): Promise<ActivityWithPriorPeriodResult> {
  const activities = new Map<
    string,
    { current: ContractActivity; prior: ContractActivity }
  >(contractIds.map((id) => [id, { current: emptyActivity(), prior: emptyActivity() }]));
  if (contractIds.length === 0) {
    return { activities, priorPeriodAvailable: true };
  }

  let priorPeriodAvailable = true;
  const batches = chunk(contractIds, CONTRACTS_PER_BATCH);
  await Promise.all(
    batches.map(async (batchIds) => {
      const filters = chunk(batchIds, CONTRACT_IDS_PER_FILTER).map(
        (ids) => ({ type: "contract" as const, contractIds: ids }),
      );
      let cursor: string | undefined;
      let pages = 0;
      const MAX_PAGES = 30;
      // The doubled window (current + prior period) may reach past what the
      // RPC node retains, even though the single-period window alone is
      // safely within it. Rather than let that failure zero out the
      // current-period numbers too, fall back to starting from
      // currentWindowLedger on ANY failure of the first (non-cursor) call —
      // deliberately not pattern-matching the error message, since RPC
      // providers word retention errors differently and a too-narrow regex
      // here is exactly what let this silently zero everything before.
      // Prior period just comes back empty (shown as "new"/no-trend)
      // instead of the whole card blanking.
      let effectiveStart = priorWindowLedger;
      try {
        while (pages < MAX_PAGES) {
          pages += 1;
          let raw;
          try {
            raw = await sharedServer.getEvents(
              cursor ? { cursor, filters } : { startLedger: effectiveStart, filters },
            );
          } catch (err) {
            if (cursor || effectiveStart !== priorWindowLedger) throw err;
            effectiveStart = currentWindowLedger;
            priorPeriodAvailable = false;
            raw = await sharedServer.getEvents({ startLedger: effectiveStart, filters });
          }
          for (const ev of raw.events) {
            if (!ev.contractId) continue;
            const bucket = activities.get(ev.contractId.toString());
            if (!bucket) continue;
            const topics = ev.topic.map((t) => scValToNative(t as never));
            const kind = String(topics[0] ?? "").toLowerCase();
            const isInflow = INFLOW_EVENT_KINDS.has(kind);
            const isOutflow = OUTFLOW_EVENT_KINDS.has(kind);
            if (!isInflow && !isOutflow) continue;
            const data = scValToNative(ev.value as never) as Record<
              string,
              unknown
            >;
            const amount = toBigIntSafe(data.amount);
            if (amount <= 0n) continue;
            const entry = ev.ledger >= currentWindowLedger ? bucket.current : bucket.prior;
            entry.count += 1;
            if (isInflow) entry.inflowStroops += amount;
            else entry.outflowStroops += amount;
          }
          const nextCursor = raw.cursor;
          if (!nextCursor || nextCursor === cursor) break;
          cursor = nextCursor;
        }
      } catch {
        // Retention window exceeded or transient RPC error, even after the
        // current-window-only fallback — leave this batch's contracts at
        // their zeroed default.
        priorPeriodAvailable = false;
      }
    }),
  );
  return { activities, priorPeriodAvailable };
}
