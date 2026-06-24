"use client";

import {
  BASE_FEE,
  Contract,
  Account,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  SmartAccountKit,
  IndexedDBStorage,
  StellarWalletsKitAdapter,
} from "smart-account-kit";

import { NETWORK, SMART_ACCOUNT_KIT } from "@/lib/config";

/**
 * Sobre's passkey-backed smart wallet kit.
 *
 * The user's private key is a secp256r1 WebAuthn credential held in the
 * device secure enclave (FaceID, fingerprint, Windows Hello). The contract
 * that signs transactions on chain is an OpenZeppelin smart-account contract
 * that verifies the WebAuthn assertion natively via CAP-0051 (Protocol 21+).
 *
 * On testnet the deployer source account is friendbot-funded by the SDK and
 * txs submit directly to Soroban RPC, so the user never sees a fee prompt.
 * For mainnet we need a sponsor relayer (OZ Channels rejected our payload
 * with FEE_MISMATCH; Dfns or a patched SDK fee policy is the week-2 path).
 */

// secp256r1 uncompressed public key is 65 bytes (0x04 prefix + 32+32 coords).
const SECP256R1_PUBLIC_KEY_SIZE = 65;

// stellar-sdk's NULL_ACCOUNT sentinel — usable for simulate-only transactions.
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Patches the kit's private `findKeyDataByCredentialId` method.
 *
 * Two SDK ↔ contract mismatches force this patch:
 *
 *   1. The published bindings call `wallet.get_context_rules({type})`
 *      (plural). That method does not exist on the deployed OpenZeppelin
 *      smart-account contract — only `get_context_rule(id)` (singular) and
 *      `get_context_rules_count()` are exported. Without the patch, every
 *      `signAndSubmit` fails simulation with `HostError(WasmVm,
 *      MissingValue)` on `get_context_rules`.
 *   2. Even calling `get_context_rule(0)` through the typed bindings dies
 *      decoding the returned `ContextRule` struct because the bindings'
 *      field list disagrees with the deployed wasm's. The error surfaces
 *      as `TypeError: Type [object Object] was not vec, but [object Object]
 *      is`.
 *
 * So we go below the bindings entirely: simulate a raw `get_context_rule(0)`
 * call via RPC, walk the returned ScVal map by field name, find the
 * `signers` vec, locate the External signer whose key_data suffix matches
 * the credential ID, and return its raw bytes.
 *
 * Multi-rule wallets are out of scope for v1 (fresh single-passkey signups
 * always have exactly one rule at id 0). Iterating
 * `get_context_rules_count()` is the right extension when we add multi-sig.
 */
function patchFindKeyDataByCredentialId(kit: SmartAccountKit): void {
  const patched = async function findKeyDataByCredentialId(
    this: { _contractId?: string },
    credentialId: Buffer,
  ): Promise<Buffer> {
    const walletContractId = this._contractId;
    if (!walletContractId) {
      throw new Error(
        "[passkey] kit has no _contractId; expected an active session",
      );
    }

    const server = new rpc.Server(NETWORK.rpcUrl);
    const source = new Account(NULL_ACCOUNT, "0");
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.passphrase,
    })
      .addOperation(
        new Contract(walletContractId).call(
          "get_context_rule",
          xdr.ScVal.scvU32(0),
        ),
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if ("error" in sim) {
      throw new Error(
        `[passkey] get_context_rule simulate failed: ${sim.error}`,
      );
    }
    if (!sim.result?.retval) {
      throw new Error("[passkey] get_context_rule returned no retval");
    }

    // ContextRule struct: an ScMap of (Symbol → Val) pairs.
    const entries = sim.result.retval.map();
    if (!entries) {
      throw new Error("[passkey] ContextRule retval was not a map");
    }
    const signersEntry = entries.find((e) => {
      const k = e.key();
      return (
        k.switch() === xdr.ScValType.scvSymbol() &&
        k.sym().toString() === "signers"
      );
    });
    if (!signersEntry) {
      throw new Error("[passkey] ContextRule had no `signers` field");
    }

    const signers = signersEntry.val().vec();
    if (!signers) {
      throw new Error("[passkey] `signers` field was not a vec");
    }

    // Signer enum is encoded as ScVal::Vec where index 0 is the variant
    // symbol and indices 1..n are the variant's values. For External the
    // shape is [Symbol("External"), Address, Bytes] — index 2 is the
    // key_data we want.
    for (const signerScVal of signers) {
      const tagAndValues = signerScVal.vec();
      if (!tagAndValues || tagAndValues.length < 3) continue;
      const tagVal = tagAndValues[0];
      if (tagVal.switch() !== xdr.ScValType.scvSymbol()) continue;
      if (tagVal.sym().toString() !== "External") continue;
      const keyDataVal = tagAndValues[2];
      if (keyDataVal.switch() !== xdr.ScValType.scvBytes()) continue;
      const keyData = Buffer.from(keyDataVal.bytes());
      if (keyData.length <= SECP256R1_PUBLIC_KEY_SIZE) continue;
      const suffix = keyData.slice(SECP256R1_PUBLIC_KEY_SIZE);
      if (suffix.equals(credentialId)) {
        return keyData;
      }
    }

    throw new Error(
      `[passkey] No External signer matching credential ID: ${credentialId.toString("base64")}`,
    );
  };

  (kit as unknown as Record<string, unknown>).findKeyDataByCredentialId =
    patched;
}

// Promise singleton. The wallet adapter's init() is async, so we cache the
// resolved kit instead of constructing it synchronously.
let kitPromise: Promise<SmartAccountKit> | null = null;

function getKit(): Promise<SmartAccountKit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      // Namespacing storage by wasm-hash prefix lets us bump the smart-wallet
      // contract version later without colliding with old credentials.
      const storage = new IndexedDBStorage(
        `sobre:testnet:${SMART_ACCOUNT_KIT.accountWasmHash.slice(0, 16)}`,
      );

      const walletAdapter = new StellarWalletsKitAdapter({
        network: NETWORK.passphrase,
      });
      await walletAdapter.init();

      const kit = new SmartAccountKit({
        rpcUrl: NETWORK.rpcUrl,
        networkPassphrase: NETWORK.passphrase,
        accountWasmHash: SMART_ACCOUNT_KIT.accountWasmHash,
        webauthnVerifierAddress: SMART_ACCOUNT_KIT.webauthnVerifierAddress,
        storage,
        rpName: "Sobre", // shown to the user in the FaceID / fingerprint prompt
        externalWallet: walletAdapter,
      });
      patchFindKeyDataByCredentialId(kit);
      return kit;
    })();
  }
  return kitPromise;
}

/**
 * Register a new passkey and deploy a fresh smart wallet bound to it. The
 * device's passkey prompt fires inside this call; the user must complete it
 * for the wallet to deploy. Returns `{ credentialId, contractId, submitResult }`.
 */
export async function signup(displayName: string) {
  const kit = await getKit();
  return kit.createWallet("Sobre", displayName, { autoSubmit: true });
}

/**
 * Silent reconnect using any credential the browser has cached. Returns
 * `null` when no session exists, in which case the caller should fall back
 * to `signup()` or to an active passkey selection prompt.
 */
export async function connect() {
  const kit = await getKit();
  return kit.connectWallet();
}

export async function disconnect() {
  const kit = await getKit();
  await kit.disconnect();
}

/**
 * Escape hatch for callers that need the raw SDK (transfers, multi-signer
 * flows, indexer queries). Prefer the higher-level helpers above.
 */
export async function getPasskeyKit() {
  return getKit();
}
