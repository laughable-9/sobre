"use client";

import {
  Address,
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

  // Poll for inclusion (Stellar settles in ~5-6s on both testnet and mainnet).
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

/** Encode a `Vec<String>` — used for envelope_names in create_sobre +
 *  set_envelope_names. Soroban contract-side String maps to scvString. */
export function stringVecScVal(strings: readonly string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(strings.map((s) => xdr.ScVal.scvString(s)));
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

/**
 * Fetch the wasm hash a deployed contract is currently executing. We can't
 * ask the contract for this directly because Soroban exposes no env API for
 * "what's my own wasm hash"; instead we read the contract's instance ledger
 * entry, where the executable hash lives.
 *
 * Returns the hex-encoded hash (no leading 0x) so callers can compare it
 * against the hash strings the Stellar CLI prints.
 */
export async function fetchRunningWasmHash(
  contractId: string,
): Promise<string> {
  const server = getServer();
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const resp = await server.getLedgerEntries(key);
  if (resp.entries.length === 0) {
    throw new Error("contract has no instance ledger entry");
  }
  const data = resp.entries[0].val.contractData().val();
  const executable = data.instance().executable();
  // executable.switch().value is 0 for wasm, 1 for stellarAsset, 2 for token
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new Error(
      `contract is not wasm-backed (executable=${executable.switch().name})`,
    );
  }
  return executable.wasmHash().toString("hex");
}
