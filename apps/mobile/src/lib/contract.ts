/**
 * Read-only subset of web/src/lib/contract.ts. Write actions (invokeWrite,
 * Freighter signing) are intentionally omitted — there's no mobile signing
 * solution yet (see docs/tech-stack-architecture.md, Option A). This file
 * covers everything the read-only dashboard screens need.
 */

import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { NETWORK } from "./config";

let cachedServer: rpc.Server | null = null;
export function getServer(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(NETWORK.rpcUrl);
  return cachedServer;
}

/**
 * Simulate a read-only call against any contract. Returns the decoded native
 * value (whatever scValToNative produces for the contract's return type).
 * Throws on simulation error or missing retval.
 *
 * Caller is only used as the simulation's source account — no signature is
 * required because simulateTransaction doesn't broadcast.
 */
export async function simulateRead<T = unknown>(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  callerAddress: string,
): Promise<T> {
  const server = getServer();
  const contract = new Contract(contractId);
  const source = await server.getAccount(callerAddress);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) {
    throw new Error(`simulation failed: ${sim.error}`);
  }
  if (!sim.result?.retval) {
    throw new Error("simulation returned no value");
  }
  return scValToNative(sim.result.retval) as T;
}
