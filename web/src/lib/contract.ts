"use client";

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
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

/** WalletPolicy is now a Supabase-resident concept; no contract-side encoder. */
export interface WalletPolicyShape {
  requireAllSigs: boolean;
  dailyLimit: bigint | null;
  perTxThreshold: bigint | null;
  protectedEnvelopes: ("Groceries" | "Tuition" | "Savings")[];
}

/** True when a cash-out / send / transfer from `envelope` needs the
 *  multi-admin approval gate to fire. Single source of truth for the
 *  three modals (PdaxWithdraw, FundSubAccount, TransferBetweenSobres)
 *  and the settings form's "locks available" banner. Solo-admin
 *  families short-circuit — with only one signer, the row's approvers
 *  vec would fill immediately, so the approval flow is a no-op and we
 *  skip creating a family_pending_requests row entirely. */
export function isEnvelopeApprovalGated(
  policy: WalletPolicyShape,
  envelope: "Groceries" | "Tuition" | "Savings",
  adminCount: number,
): boolean {
  return adminCount >= 2 && policy.protectedEnvelopes.includes(envelope);
}

/** True when the household has enough admins to make an envelope lock
 *  meaningful. Threshold matches `isEnvelopeApprovalGated`. Used by
 *  the settings form to disable the enable-lock toggles below the
 *  threshold. */
export function envelopeLocksActive(adminCount: number): boolean {
  return adminCount >= 2;
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
