"use client";

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

import { NETWORK } from "@/lib/config";
import {
  getDeployerAddress,
  signTransaction,
  submitPasskeySigned,
} from "@/lib/passkey";

let cachedServer: rpc.Server | null = null;
export function getServer(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(NETWORK.rpcUrl);
  return cachedServer;
}

/** Stub `Account` for read-only simulations. simulateTransaction ignores
 *  the source's on-chain seq so we save the getAccount RPC. The user's
 *  smart-wallet C-address can't be the source either way because
 *  `server.getAccount()` only resolves G-account ledger entries. */
export function simulateSourceAccount(): Account {
  return new Account(getDeployerAddress(), "0");
}

export interface WriteResult {
  hash: string;
  /** Contract return value parsed via scValToNative — null when the contract
   *  returns void. */
  returnValue: unknown;
}

/** Runtime AT shape with the bits we read after sign — the simulationData
 *  block isn't on the public type, hence the local alias. */
type ATWithSim = import(
  "@stellar/stellar-sdk/contract"
).AssembledTransaction<unknown> & {
  simulationData?: {
    result?: { retval?: xdr.ScVal };
    transactionData?: unknown;
  };
};

/**
 * Passkey-signed contract write. Three phases, each owned by a different
 * module: build the raw tx here, hand to passkey-kit (FaceID prompt) which
 * returns an AT carrying signed auth entries, then post-sign rebuild +
 * submit lives in `submitPasskeySigned` (shared with `createFamilyWallet`).
 *
 * Between sign and submit we re-simulate the AT: the buildWithOp simulate
 * passkey-kit runs internally executes without signatures, so it misses the
 * signer-storage reads `__check_auth` does. The footprint widens here.
 *
 * Return value is decoded from the simulation retval rather than the
 * post-inclusion result so callers don't pay the inclusion-poll latency
 * twice.
 */
export async function invokeWrite(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<WriteResult> {
  const server = getServer();
  const contract = new Contract(contractId);

  const source = await server.getAccount(getDeployerAddress());
  const built = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Pre-simulate to populate the auth entry with recording-mode credentials.
  // Without this, passkey-kit's sign() takes a fromXDR fast path that doesn't
  // simulate internally, leaves the AT with zero auth entries, and
  // signAuthEntries no-ops — no FaceID prompt, submit fails at require_auth.
  const prepared = await server.prepareTransaction(built);

  // FaceID prompt fires inside signTransaction. See the gotcha note in
  // passkey.ts:signTransaction — we MUST use the return value.
  const signedAT = (await signTransaction<unknown>(prepared)) as ATWithSim;

  // Capture the signed auth entries — the re-simulate below applies the
  // RPC's auth response back to .built.operations[0].auth and would wipe
  // the signatures otherwise. Submit-time __check_auth then traps with
  // UnreachableCodeReached because the signer lookup runs without a
  // signature to match.
  const signedAuth = (
    signedAT.built?.operations[0] as
      | { auth?: unknown[] }
      | undefined
  )?.auth;

  // Widen the footprint to cover signer-storage reads __check_auth performs.
  // The initial sim passkey-kit ran was unsigned, so it never executed
  // __check_auth — the footprint missed the smart wallet's signer reads.
  await signedAT.simulate({ restore: true });

  // Restore the captured signatures over whatever the re-simulate wrote.
  if (signedAuth && signedAT.built) {
    (signedAT.built.operations[0] as { auth?: unknown }).auth = signedAuth;
  }

  const sent = await submitPasskeySigned(signedAT);

  const retval = signedAT.simulationData?.result?.retval;
  const returnValue = retval ? scValToNative(retval) : null;
  return { hash: sent.hash, returnValue };
}

/**
 * Simulate a read-only call against any contract. Returns the decoded native
 * value (whatever scValToNative produces for the contract's return type).
 * Throws on simulation error or missing retval.
 *
 * Source is a stub `Account` for the deployer G-address: simulateTransaction
 * ignores the source's on-chain seq so we save an RPC by not fetching it.
 * The user's smart-wallet C-address can't be the source either way because
 * `server.getAccount()` only resolves G-account ledger entries.
 */
export async function simulateRead<T = unknown>(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<T> {
  const server = getServer();
  const contract = new Contract(contractId);
  const source = simulateSourceAccount();
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

export interface SpendPolicyShape {
  requireAllSigs: boolean;
  dailyLimit: bigint | null;
  /** Per-tx approval threshold in stroops; null = no per-tx gate. */
  perTxThreshold: bigint | null;
  protectedEnvelopes: ("Groceries" | "Tuition" | "Savings")[];
}

/**
 * Encode a SpendPolicy struct as an ScVal map. Field order matters — Soroban
 * sorts struct map entries alphabetically by key:
 *     daily_limit < per_tx_threshold < protected_envelopes < require_all_sigs
 */
export function spendPolicyScVal(policy: SpendPolicyShape): xdr.ScVal {
  const optI128 = (v: bigint | null) =>
    v === null ? xdr.ScVal.scvVoid() : nativeToScVal(v, { type: "i128" });
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("daily_limit"),
      val: optI128(policy.dailyLimit),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("per_tx_threshold"),
      val: optI128(policy.perTxThreshold),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("protected_envelopes"),
      val: xdr.ScVal.scvVec(policy.protectedEnvelopes.map(envelopeScVal)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("require_all_sigs"),
      val: xdr.ScVal.scvBool(policy.requireAllSigs),
    }),
  ]);
}

/**
 * One settings change to feed `apply_settings`. Mirrors the Rust enum
 * `SettingsField`:
 *   Percents(Vec<u32>) | Policy(SpendPolicy)
 *
 * The per-tx threshold lives inside the policy (`perTxThreshold`); to change
 * it, ship a full Policy variant. "Whole-policy replacement" semantics match
 * how `daily_limit` already works.
 */
export type SettingsField =
  | { kind: "Percents"; percents: [number, number, number] }
  | { kind: "Policy"; policy: SpendPolicyShape };

/** Encode a single SettingsField variant as an ScVal. Soroban enum-with-data
 *  serialises as `scvVec([symbol, payload])`. */
export function settingsFieldScVal(field: SettingsField): xdr.ScVal {
  switch (field.kind) {
    case "Percents":
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Percents"),
        percentsScVal(field.percents),
      ]);
    case "Policy":
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Policy"),
        spendPolicyScVal(field.policy),
      ]);
  }
}

/** Single ScVal arg for `apply_settings(updates: Vec<SettingsField>)`. */
export function settingsFieldsArg(fields: SettingsField[]): xdr.ScVal {
  return xdr.ScVal.scvVec(fields.map(settingsFieldScVal));
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
