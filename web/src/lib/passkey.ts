"use client";

import {
  hash,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { PasskeyClient, PasskeyKit } from "passkey-kit";
import { PasskeyServer } from "passkey-kit/server";

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

/**
 * HMR-tolerant singleton. `let kit` would null out on Next.js Fast Refresh
 * every time we save a file — the React hook state still claims connected
 * but the underlying kit forgets `kit.wallet`, so the next `signTransaction`
 * panics. Caching the kit on `globalThis` survives module re-evaluation;
 * production is unaffected because the module evaluates once there.
 */
const KIT_GLOBAL_KEY = "__sobrePasskeyKit";
type KitGlobal = typeof globalThis & {
  [KIT_GLOBAL_KEY]?: PasskeyKit;
};

let relayer: PasskeyServer | null = null;
let cachedServer: rpc.Server | null = null;

function getKit(): PasskeyKit {
  const g = globalThis as KitGlobal;
  if (!g[KIT_GLOBAL_KEY]) {
    g[KIT_GLOBAL_KEY] = new PasskeyKit({
      rpcUrl: NETWORK.rpcUrl,
      networkPassphrase: NETWORK.passphrase,
      walletWasmHash: PASSKEY_KIT.walletWasmHash,
      // OpenZeppelin Relayer caps tx timeout at 30s. We don't use the
      // relayer (direct RPC), but matching keeps things compatible if we
      // wire it later.
      timeoutInSeconds: 30,
    });
  }
  return g[KIT_GLOBAL_KEY]!;
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
    // passkey-kit 0.14 moved relayer config under a nested `relayer` bag
    // (was `relayerUrl` / `relayerApiKey` at the top level in 0.12).
    relayer = new PasskeyServer({
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.rpcUrl,
      relayer: {
        baseUrl: `${window.location.origin}/api/passkey/relayer`,
        apiKey: "proxied-server-side",
      },
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
  const patched = bumpDeployFeeAndResign(signedTx);
  const result = await submit(patched);
  return { keyIdBase64, contractId, hash: result.hash, ledger: result.ledger };
}

/** passkey-kit 0.14.0's SubmissionManager.signDeploy sets the tx fee to the
 *  Soroban resource_fee ONLY, missing the per-op inclusion fee (min 100
 *  stroops). Network rejects with txInsufficientFee. Because our deployer
 *  keypair is derived from the public "kalepail" seed, we have the private
 *  key here — parse the signed XDR, bump the fee, drop the invalidated
 *  envelope signature, and re-sign. Passkey Soroban auth entries live in
 *  the operation (not the envelope), so they survive intact. */
function bumpDeployFeeAndResign(signedXdr: string): string {
  const envelope = xdr.TransactionEnvelope.fromXDR(signedXdr, "base64");
  if (envelope.switch().name !== "envelopeTypeTx") return signedXdr;
  const v1 = envelope.v1();
  const inner = v1.tx();
  const sorobanData = inner.ext().sorobanData();
  const resourceFee = Number(sorobanData.resourceFee().toString());
  // Add a generous inclusion buffer so surge pricing / a slightly-off
  // resource_fee estimate can't cause a second insufficient-fee bounce.
  // 10_000 stroops = 0.001 XLM, negligible next to the ~0.14 XLM resource fee.
  const targetFee = resourceFee + 10_000;
  if (Number(inner.fee()) >= targetFee) return signedXdr;

  // Transaction.fee is a Uint32 in the XDR schema. Set via the js-xdr
  // struct accessor.
  inner.fee(targetFee);

  // Wipe the now-invalid deployer sig, re-sign the fresh envelope XDR.
  v1.signatures([]);
  const tx = TransactionBuilder.fromXDR(
    envelope.toXDR("base64"),
    NETWORK.passphrase,
  );
  tx.sign(DEPLOYER_KEYPAIR);
  return tx.toEnvelope().toXDR("base64");
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
  // Default expiration of `latestLedger + SIG_EXPIRATION_WINDOW_LEDGERS`
  // gives the signed TX a comfortable window between sign and inclusion.
  // Without an explicit value, passkey-kit / stellar-sdk has fallen back
  // to ~1 ledger on testnet, which races against RPC indexing lag and
  // surfaces as "signature has expired" at execution time. 100 ledgers
  // (~8 minutes) is well beyond any reasonable sign→submit→include
  // pipeline without becoming a replay-attack risk for the demo.
  const { sequence } = await getServer().getLatestLedger();
  // passkey-kit 0.14 changed the sign signature to
  // `sign(txn, signer?, options?)` — the options bag (with `expiration`)
  // moved from the 2nd arg to the 3rd, and the signer defaults to the
  // connected passkey when undefined.
  return (await kit.sign(
    txn as unknown as Parameters<typeof kit.sign>[0],
    undefined,
    { expiration: sequence + SIG_EXPIRATION_WINDOW_LEDGERS },
  )) as unknown as import(
    "@stellar/stellar-sdk/contract"
  ).AssembledTransaction<T>;
}

/** How many ledgers ahead to set every passkey-signed TX's
 *  signature_expiration_ledger. 1 ledger ≈ 5s → 100 ledgers ≈ 8 minutes. */
const SIG_EXPIRATION_WINDOW_LEDGERS = 100;

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
    const errXdr = send.errorResult?.toXDR("base64") ?? "unknown";
    // Decode the TransactionResult so the user sees a useful message
    // instead of a base64 blob. The canonical case we hit is txBAD_SEQ
    // — the deployer's sequence number on the signed tx lagged the
    // chain, usually because Soroban RPC hadn't indexed our previous
    // tx yet when we fetched the account. The fee_charged field varies
    // per tx so exact-string matching on the base64 doesn't work; we
    // properly parse the XDR and check the result code.
    const code = decodeTxResultCode(errXdr);
    if (code === "txBadSeq") {
      throw new Error(
        "Network is catching up to your previous transaction. Tap again in a few seconds.",
      );
    }
    throw new Error(`submit failed: ${errXdr}`);
  }

  const result = await server.pollTransaction(send.hash, { attempts: 30 });
  if (result.status === "SUCCESS") {
    return { hash: send.hash, ledger: result.ledger };
  }

  // FAILED — decode result-XDR + diagnostic events into a human message
  // so the audience doesn't see a base64 blob mid-demo. The full XDR is
  // still appended as a debug suffix in case we need to dig in later.
  const failed = result as {
    resultXdr?: { toXDR(format: "base64"): string };
    diagnosticEventsXdr?: Array<{ toXDR(f: "base64"): string }>;
  };
  const resultXdr = failed.resultXdr?.toXDR("base64") ?? "";
  const eventsXdrs =
    failed.diagnosticEventsXdr?.slice(0, 5).map((e) => e.toXDR("base64")) ?? [];
  const decoded = decodeFailedExecution(resultXdr, eventsXdrs);
  throw new Error(
    `${decoded} (hash=${send.hash.slice(0, 8)}…${send.hash.slice(-4)})`,
  );
}

/** Decode a FAILED transaction's resultXdr + diagnostic events into a
 *  human-readable cause. Looks for, in order:
 *   1. A `scvError` Soroban error inside the diagnostic events — names
 *      like `ExceededLimit`, `InvalidAction` etc. surface the contract
 *      trap directly.
 *   2. The first operation result's name (typically
 *      `INVOKE_HOST_FUNCTION_TRAPPED` / `_RESOURCE_LIMIT_EXCEEDED`).
 *   3. The top-level transaction result code (`txFailed`, etc.).
 *  Falls back to a generic message if nothing decodes cleanly. */
function decodeFailedExecution(
  errXdr: string,
  eventsXdrs: string[],
): string {
  // 1. Contract-level scvError, if present in diagnostic events.
  for (const eventXdr of eventsXdrs) {
    try {
      const evt = xdr.DiagnosticEvent.fromXDR(eventXdr, "base64");
      const body = evt.event().body().v0();
      // Look at the event data first (panic value).
      const data = body.data();
      if (data.switch().name === "scvError") {
        const name = data.error().switch().name;
        return `Contract error: ${humanize(name)}`;
      }
      // Then topics (Soroban often emits ("error", <code>) tuples).
      for (const topic of body.topics()) {
        if (topic.switch().name === "scvError") {
          const name = topic.error().switch().name;
          return `Contract error: ${humanize(name)}`;
        }
      }
    } catch {
      // skip undecodable events
    }
  }

  // 2/3. Top-level + op-level result code. Two try blocks: the outer
  // protects the whole TransactionResult parse, the inner only the
  // InvokeHostFunction-specific accessor (which throws on non-host-fn
  // ops, where we fall back to the generic op switch name).
  let txCode: string | null = null;
  let opCode: string | null = null;
  try {
    const tr = xdr.TransactionResult.fromXDR(errXdr, "base64");
    txCode = tr.result().switch().name;
    if (txCode === "txFailed") {
      const first = tr.result().results()[0];
      if (first) {
        try {
          opCode = first.tr().invokeHostFunctionResult().switch().name;
        } catch {
          opCode = first.switch().name;
        }
      }
    }
  } catch {
    // leave txCode/opCode as collected so far; falls through to the
    // generic "Transaction failed on chain" message below.
  }
  if (opCode) return `Operation failed: ${humanize(opCode)}`;
  if (txCode) return `Transaction failed: ${humanize(txCode)}`;
  return "Transaction failed on chain (undecodable error)";
}

/** Tidy an XDR enum name for display. Drops common prefixes
 *  ("INVOKE_HOST_FUNCTION_", "tx") and converts snake/camel to spaced
 *  Title Case so error names read as English. */
function humanize(name: string): string {
  const stripped = name
    .replace(/^INVOKE_HOST_FUNCTION_/, "")
    .replace(/^tx/, "")
    .replace(/^scec/, "")
    .replace(/_/g, " ")
    .toLowerCase();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Parse a base64 TransactionResult XDR and return the canonical result-
 *  code name (e.g. "txBadSeq", "txInsufficientFee"). Returns null on any
 *  decode error so the caller falls through to the raw XDR string. */
function decodeTxResultCode(errXdr: string): string | null {
  try {
    const result = xdr.TransactionResult.fromXDR(errXdr, "base64");
    return result.result().switch().name;
  } catch {
    return null;
  }
}

/** Disconnect — passkey-kit doesn't keep server state, just clear the
 *  instance so the next call starts fresh. */
export function disconnect() {
  delete (globalThis as KitGlobal)[KIT_GLOBAL_KEY];
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
