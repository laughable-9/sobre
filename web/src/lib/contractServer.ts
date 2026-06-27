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
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { NETWORK } from "@/lib/config";

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
