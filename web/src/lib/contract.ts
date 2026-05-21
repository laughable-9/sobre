"use client";

import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

import { NETWORK } from "@/lib/config";

let cachedServer: rpc.Server | null = null;
export function getServer(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(NETWORK.rpcUrl);
  return cachedServer;
}

export interface WriteResult {
  hash: string;
  /** Contract return value parsed via scValToNative — null when the contract
   *  returns void. */
  returnValue: unknown;
}

/**
 * Build → prepare (simulate + assemble) → Freighter-sign → submit → poll.
 * Returns the tx hash + decoded return value on success. The contract ID is
 * per-call so the same helper drives the factory plus every per-family Sobre.
 */
export async function invokeWrite(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  userAddress: string,
): Promise<WriteResult> {
  const server = getServer();
  const contract = new Contract(contractId);

  const source = await server.getAccount(userAddress);
  const built = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  // prepareTransaction runs the simulation and bakes the auth+footprint
  // into the tx so it's ready to sign and submit.
  const prepared = await server.prepareTransaction(built);

  const { signedTxXdr, error: signErr } = await signTransaction(
    prepared.toXDR(),
    {
      networkPassphrase: NETWORK.passphrase,
      address: userAddress,
    },
  );
  if (signErr) {
    throw new Error(signErr.message ?? "Freighter denied the signature.");
  }

  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase);
  const sent = await server.sendTransaction(signed);

  if (sent.status === "ERROR") {
    const xdrStr = sent.errorResult?.toXDR("base64");
    throw new Error(`send failed: ${xdrStr ?? "unknown"}`);
  }

  // Poll for inclusion (testnet usually settles in ~5s).
  for (let i = 0; i < 30; i++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") {
      const returnValue = result.returnValue
        ? scValToNative(result.returnValue)
        : null;
      return { hash: sent.hash, returnValue };
    }
    if (result.status === "FAILED") {
      throw new Error("tx failed on chain");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("tx not confirmed within 30s");
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

/** Helper to build the ScVal for a `#[contracttype] enum Envelope::X` unit variant. */
export function envelopeScVal(
  variant: "Groceries" | "Tuition" | "Savings",
): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
}

/** Encode the envelope split as `Vec<u32>` for create_sobre + set_envelopes. */
export function percentsScVal(
  percents: [number, number, number],
): xdr.ScVal {
  return xdr.ScVal.scvVec(percents.map((p) => xdr.ScVal.scvU32(p)));
}

/**
 * Encode a SpendPolicy struct as an ScVal map. Field order matters — Soroban
 * sorts struct map entries alphabetically by key:
 *     daily_limit < protected_envelopes < require_all_sigs
 */
export function spendPolicyScVal({
  requireAllSigs,
  dailyLimit,
  protectedEnvelopes,
}: {
  requireAllSigs: boolean;
  dailyLimit: bigint | null;
  protectedEnvelopes: ("Groceries" | "Tuition" | "Savings")[];
}): xdr.ScVal {
  const dailyLimitVal =
    dailyLimit === null
      ? xdr.ScVal.scvVoid()
      : nativeToScVal(dailyLimit, { type: "i128" });

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("daily_limit"),
      val: dailyLimitVal,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("protected_envelopes"),
      val: xdr.ScVal.scvVec(protectedEnvelopes.map(envelopeScVal)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("require_all_sigs"),
      val: xdr.ScVal.scvBool(requireAllSigs),
    }),
  ]);
}
