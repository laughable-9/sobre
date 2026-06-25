"use client";

import {
  hash,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { PasskeyClient, PasskeyKit, PasskeyServer } from "passkey-kit";

import { NETWORK, PASSKEY_KIT } from "@/lib/config";

/**
 * Sobre's passkey-backed smart wallet kit. We use kalepail/passkey-kit
 * because:
 *
 *   - Verification is inline in the wallet WASM (no separate WebAuthn
 *     verifier contract that can drift out of sync with bindings — the
 *     failure mode that broke smart-account-kit for us was an external
 *     verifier rejecting valid signatures).
 *   - The API is small: createWallet, connectWallet, sign. Submit is up
 *     to us, which lets us use direct RPC on testnet without depending
 *     on the OZ Channels relayer.
 *   - Production-validated by Meridian Pay (~1k users) on the same
 *     contract lineage.
 *
 * Lazy promise-singleton: the wallet adapter doesn't need async init, so
 * we could construct synchronously, but caching the instance lets us reuse
 * the per-instance `wallet` and `keyId` fields after connectWallet.
 */

/**
 * The Stellar G-account whose envelope signature wraps every smart-wallet
 * tx we submit. passkey-kit derives this from the public seed "kalepail"
 * (sha256 → 32-byte ed25519 seed). Friendbot funds it on demand. The seed
 * is intentionally public so anyone running the demo can use the same
 * funded source on testnet — not a security concern because the smart
 * wallet's authorization comes through Soroban auth entries, not the
 * envelope signature.
 *
 * On mainnet this gets swapped for a relayer (OZ Channels or self-hosted)
 * that wraps with fee-bump.
 */
const DEPLOYER_KEYPAIR = Keypair.fromRawEd25519Seed(
  hash(Buffer.from("kalepail")),
);

let kit: PasskeyKit | null = null;
let relayer: PasskeyServer | null = null;
let cachedServer: rpc.Server | null = null;

function getKit(): PasskeyKit {
  if (!kit) {
    kit = new PasskeyKit({
      rpcUrl: NETWORK.rpcUrl,
      networkPassphrase: NETWORK.passphrase,
      walletWasmHash: PASSKEY_KIT.walletWasmHash,
      // OpenZeppelin Relayer caps tx timeout at 30s. We don't use the
      // relayer (direct RPC), but matching keeps things compatible if we
      // wire it later.
      timeoutInSeconds: 30,
    });
  }
  return kit;
}

function getServer(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(NETWORK.rpcUrl);
  return cachedServer;
}

/**
 * Passkey-kit server-side helper bound to our same-origin relayer proxy.
 * The proxy at /api/passkey/relayer attaches the real Channels API key
 * server-side; the browser never sees it. Passing a placeholder apiKey
 * just satisfies the ChannelsClient constructor's truthy check.
 */
function getRelayerServer(): PasskeyServer {
  if (!relayer) {
    relayer = new PasskeyServer({
      rpcUrl: NETWORK.rpcUrl,
      relayerUrl: `${window.location.origin}/api/passkey/relayer`,
      relayerApiKey: "proxied-server-side",
    });
  }
  return relayer;
}

export interface SignupResult {
  /** Base64URL-encoded WebAuthn credential ID. Persist this — it's the key
   *  passkey-kit uses to reconnect a user to their wallet. */
  keyIdBase64: string;
  /** Smart-wallet contract C-address freshly deployed for this user. */
  contractId: string;
  /** On-chain submission result for the deploy tx. */
  hash: string;
  ledger: number | undefined;
}

/**
 * Register a passkey + deploy a smart-wallet contract bound to it. The
 * device's FaceID/fingerprint prompt fires inside createWallet().
 *
 * `userIdentifier` should be the user's email so passkey managers
 * (1Password, iCloud Keychain) group the credential under the right
 * account.
 */
export async function signup(
  userIdentifier: string,
): Promise<SignupResult> {
  const kit = getKit();
  const { keyIdBase64, contractId, signedTx } = await kit.createWallet(
    "Sobre",
    userIdentifier,
  );
  const result = await submit(signedTx);
  return { keyIdBase64, contractId, hash: result.hash, ledger: result.ledger };
}

/**
 * Re-attach to an existing wallet using the `(keyIdBase64, contractId)`
 * pair we have in Supabase. We set `kit.wallet` and `kit.keyId` directly,
 * bypassing `kit.connectWallet()` — that path derives a contract ID from
 * `walletPublicKey + keyId` and 404s on `rpc.getContractData` when the
 * derived ID doesn't match the on-chain one (which happens for any
 * wallet not deployed with kalepail-kit's exact derivation pattern).
 *
 * Subsequent `signTransaction()` calls fire a passkey prompt scoped to the
 * stored `keyId`.
 */
export function connect(opts: {
  keyIdBase64: string;
  contractId: string;
}): { keyId: string; contractId: string } {
  const kit = getKit();
  kit.keyId = opts.keyIdBase64;
  kit.wallet = new PasskeyClient({
    contractId: opts.contractId,
    networkPassphrase: NETWORK.passphrase,
    rpcUrl: NETWORK.rpcUrl,
  });
  return { keyId: opts.keyIdBase64, contractId: opts.contractId };
}

/**
 * Sign a tx's auth entries with the user's passkey. Accepts any of:
 *   - an AssembledTransaction (from createFamilyWallet's Client.from path)
 *   - a raw Transaction (from invokeWrite's Contract.call path)
 *   - a base64 XDR string
 *
 * The passkey prompt fires inside this call.
 *
 * IMPORTANT: passkey-kit imports `AssembledTransaction` from
 * `@stellar/stellar-sdk/minimal/contract` while our consumer imports from
 * `@stellar/stellar-sdk`. The classes are different, so passkey-kit's
 * `instanceof` check fails. It falls through to a fromXDR rebuild (using
 * the wallet's spec) and, if that throws because the method isn't a wallet
 * method, to `AssembledTransaction.buildWithOp` — which re-simulates and
 * populates auth entries internally. Either way the returned AT carries the
 * signed entries; the caller MUST use the return value rather than assume
 * the input was mutated.
 */
export async function signTransaction<T>(
  txn:
    | import("@stellar/stellar-sdk/contract").AssembledTransaction<T>
    | Transaction
    | string,
): Promise<import("@stellar/stellar-sdk/contract").AssembledTransaction<T>> {
  const kit = getKit();
  return (await kit.sign(
    txn as unknown as Parameters<typeof kit.sign>[0],
  )) as unknown as import("@stellar/stellar-sdk/contract").AssembledTransaction<T>;
}

/**
 * Kept for the eventual mainnet path: submits via the OpenZeppelin
 * Channels relayer (fee-bump, sponsor pays gas). Unused on testnet — we
 * sign with the public kalepail deployer keypair and submit directly via
 * RPC. Will replace `submit()` once we provision a real Channels API key
 * for the production demo.
 */
export async function submitViaRelayer(
  txn: string | { built?: { toXDR(): string }; toXDR(): string },
): Promise<unknown> {
  const relayer = getRelayerServer();
  return relayer.send(
    txn as unknown as Parameters<typeof relayer.send>[0],
  );
}

/**
 * Direct-RPC submission. Sends the signed XDR, polls until the SDK reports
 * SUCCESS/FAILED, and surfaces the result-XDR + first few diagnostic
 * events on failure so we can decode the cause without a separate RPC
 * round-trip.
 */
export async function submit(
  signed: string | { toXDR(): string },
): Promise<{ hash: string; ledger?: number }> {
  const xdrString = typeof signed === "string" ? signed : signed.toXDR();
  const tx = TransactionBuilder.fromXDR(xdrString, NETWORK.passphrase);

  const server = getServer();
  const send = await server.sendTransaction(tx);
  if (send.status === "ERROR") {
    throw new Error(
      `submit failed: ${send.errorResult?.toXDR("base64") ?? "unknown"}`,
    );
  }

  const result = await server.pollTransaction(send.hash, { attempts: 30 });
  if (result.status === "SUCCESS") {
    return { hash: send.hash, ledger: result.ledger };
  }

  // FAILED — surface enough context to decode the panic without a follow-up
  // RPC call. resultXdr names the op-level Stellar error, diagnostic events
  // (first 3) name the contract-side trap.
  const failed = result as {
    resultXdr?: { toXDR(format: "base64"): string };
    diagnosticEventsXdr?: Array<{ toXDR(f: "base64"): string }>;
  };
  const resultXdr = failed.resultXdr?.toXDR("base64") ?? "(no resultXdr)";
  const events =
    failed.diagnosticEventsXdr
      ?.slice(0, 3)
      .map((e) => e.toXDR("base64"))
      .join(" | ") ?? "(no diagnostic events)";
  throw new Error(
    `tx failed on chain | hash=${send.hash} | result=${resultXdr} | events=${events}`,
  );
}

/** Disconnect — passkey-kit doesn't keep server state, just clear the
 *  instance so the next call starts fresh. */
export function disconnect() {
  kit = null;
}

/** Escape hatch for callers that need the raw kit (e.g. for adding signers
 *  via kit.addSecp256r1). Prefer the helpers above. */
export function getPasskeyKit() {
  return getKit();
}

/** Public deployer G-address — the source account for wrapping smart-wallet
 *  tx envelopes on testnet. */
export function getDeployerAddress(): string {
  return DEPLOYER_KEYPAIR.publicKey();
}

/**
 * Add an envelope-level signature with the testnet deployer keypair to an
 * already-built (and passkey-signed-auth-entry) Transaction.
 *
 * We mutate the built Tx directly (rather than going through
 * AssembledTransaction.sign()) because passkey-kit's signAuthEntries
 * mutates the JS-side `op.auth` array but stellar-base's
 * `Transaction.toXDR()` serialises from the underlying `_tx` XDR, which
 * doesn't see those JS mutations. `submitPasskeySigned` below rebuilds the
 * tx with the signed entries baked into a fresh InvokeHostFunction op; this
 * helper then envelope-signs it.
 */
export function signEnvelopeWithDeployer<T extends { sign(kp: Keypair): void }>(
  tx: T,
): T {
  tx.sign(DEPLOYER_KEYPAIR);
  return tx;
}

/** Carries the bits both passkey-signed code paths need off an AT after
 *  `signTransaction()`. The runtime AT exposes these but they're not on the
 *  public type, so we re-declare. */
export interface PasskeySignedTx {
  built?: Transaction;
  simulationData?: {
    transactionData?: unknown;
  };
}

/**
 * Rebuild a passkey-signed AT and submit it. This is the dance shared by
 * `invokeWrite` (one-off contract calls) and `createFamilyWallet` (factory
 * deploy). passkey-kit's `signAuthEntries` mutates `op.auth` on the JS side,
 * but `Transaction.toXDR()` serialises from the underlying `_tx` XDR which
 * doesn't see those mutations — so we extract the signed entries, bake them
 * into a fresh InvokeHostFunction op, carry the simulated Soroban resource
 * data forward, sign the envelope with the deployer, and submit.
 *
 * Caller is responsible for calling `signTransaction(...)` first AND for any
 * post-sign re-simulate (e.g. footprint widening for `__check_auth` reads).
 */
export async function submitPasskeySigned(
  signedAT: PasskeySignedTx,
): Promise<{ hash: string; ledger?: number }> {
  if (!signedAT.built) throw new Error("AT.built is not set");
  const originalOp = signedAT.built.operations[0] as
    | import("@stellar/stellar-sdk").Operation.InvokeHostFunction
    | undefined;
  if (!originalOp || originalOp.type !== "invokeHostFunction") {
    throw new Error("expected invokeHostFunction operation");
  }

  const server = getServer();
  const source = await server.getAccount(DEPLOYER_KEYPAIR.publicKey());

  const builder = new TransactionBuilder(source, {
    fee: signedAT.built.fee,
    networkPassphrase: NETWORK.passphrase,
  }).addOperation(
    Operation.invokeHostFunction({
      func: originalOp.func,
      auth: originalOp.auth ?? [],
    }),
  );

  if (signedAT.simulationData?.transactionData) {
    builder.setSorobanData(
      signedAT.simulationData.transactionData as Parameters<
        typeof builder.setSorobanData
      >[0],
    );
  }

  const rebuilt = builder.setTimeout(30).build();
  rebuilt.sign(DEPLOYER_KEYPAIR);
  return submit(rebuilt.toXDR());
}
