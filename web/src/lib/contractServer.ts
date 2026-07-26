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
