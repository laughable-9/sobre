"use client";

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

      return new SmartAccountKit({
        rpcUrl: NETWORK.rpcUrl,
        networkPassphrase: NETWORK.passphrase,
        accountWasmHash: SMART_ACCOUNT_KIT.accountWasmHash,
        webauthnVerifierAddress: SMART_ACCOUNT_KIT.webauthnVerifierAddress,
        storage,
        rpName: "Sobre", // shown to the user in the FaceID / fingerprint prompt
        externalWallet: walletAdapter,
      });
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
