/**
 * Server-side SAC transfer relay. Bridges the PDAX → smart-wallet gap:
 * PDAX delivers the payment token to a server-held G-address, then this
 * helper signs + submits a SAC `transfer` from the relay to the user's
 * smart-wallet C-address.
 *
 * NEVER import from a "use client" file. The relay's secret key would leak
 * into the browser bundle.
 *
 * The relay is NOT a treasury. PDAX is the sole source of funds — the
 * G-address holds the in-flight withdrawal for a few seconds and then
 * forwards. The XLM Friendbot bootstrap is only there to pay tx fees +
 * the 1 XLM base reserve; user balances always net to zero.
 */

import "server-only";

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

import { NETWORK, PAYMENT_TOKEN_SAC_ID } from "@/lib/config";
import { relayEnv } from "@/lib/env";

let cachedServer: rpc.Server | null = null;
function getServer(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(NETWORK.rpcUrl);
  return cachedServer;
}

let cachedKeypair: Keypair | null = null;
function getRelayKeypair(): Keypair {
  if (!cachedKeypair) cachedKeypair = Keypair.fromSecret(relayEnv().secret);
  return cachedKeypair;
}

/** Public G-address of the relay. Stable for the life of the secret. */
export function getRelayPublicKey(): string {
  return getRelayKeypair().publicKey();
}

/**
 * Transfer `stroops` of the active payment-token SAC from the relay to
 * `destinationCAddress`. Submits via Soroban RPC, polls for inclusion,
 * returns the tx hash on success.
 *
 * Uses the standard SEP-41 `transfer(from, to, amount: i128)` interface.
 * `from = relay G-address` requires the envelope to be signed by the
 * relay's keypair — which is what the `tx.sign(kp)` below does. No
 * Soroban auth entries needed for a regular G-account source.
 */
export async function transferFromRelay(
  destinationCAddress: string,
  stroops: bigint,
): Promise<string> {
  const server = getServer();
  const kp = getRelayKeypair();

  const account = await server.getAccount(kp.publicKey());
  const tokenContract = new Contract(PAYMENT_TOKEN_SAC_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(
      tokenContract.call(
        "transfer",
        Address.fromString(kp.publicKey()).toScVal(),
        Address.fromString(destinationCAddress).toScVal(),
        nativeToScVal(stroops, { type: "i128" }),
      ),
    )
    .setTimeout(30)
    .build();

  // prepareTransaction runs simulation + populates Soroban footprint /
  // resource fees so the network accepts the submission. Auth entries
  // aren't needed because the source (relay G-address) is also the
  // `from` of the SAC transfer — Soroban accepts the source signature
  // as authorization for the source account.
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(
      `relay sendTransaction ERROR: ${JSON.stringify(sent.errorResult?.toXDR("base64") ?? sent)}`,
    );
  }

  // Poll for inclusion. Soroban RPC's getTransaction returns NOT_FOUND
  // until the ledger includes the tx, then SUCCESS or FAILED.
  const hash = sent.hash;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await server.getTransaction(hash);
    if (status.status === "SUCCESS") return hash;
    if (status.status === "FAILED") {
      throw new Error(
        `relay tx FAILED on chain: ${JSON.stringify(decodeResultXdr(status))}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`relay tx ${hash} did not confirm within 30s`);
}

function decodeResultXdr(status: {
  resultXdr?: { toXDR: (encoding: "base64") => string };
}): string {
  try {
    return status.resultXdr?.toXDR("base64") ?? "<no resultXdr>";
  } catch {
    return "<resultXdr decode failed>";
  }
}
