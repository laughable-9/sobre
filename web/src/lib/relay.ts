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
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

import { NETWORK, STROOPS_PER_TOKEN } from "@/lib/config";
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
 * PDAX-ramp entry: the relay G-address invokes the family Sobre contract's
 * `deposit_from_xlm` with the XLM it just received from PDAX + the
 * per-envelope split (in USDC stroops) the caller has already computed
 * from the family's Supabase-stored percentages.
 *
 * The Sobre contract does the Soroswap XLM→USDC swap internally, then
 * credits envelopes. No trustlines needed on the relay (XLM is native)
 * and no user-signed follow-up step (the whole flow is server-side).
 *
 * Returns the tx hash on Horizon-confirmed success. Throws on
 * submit/timeout failures. Throws with contract error 8 (InsufficientBalance)
 * when the caller's expected split total exceeds what Soroswap actually
 * delivers — caller should shrink the split or accept a smaller USDC total.
 */
export async function depositFromXlmToSobre(args: {
  familyContractId: string;
  relayXlmStroops: bigint;
  split: { groceries: bigint; tuition: bigint; savings: bigint };
}): Promise<string> {
  const server = getServer();
  const kp = getRelayKeypair();

  const account = await server.getAccount(kp.publicKey());
  const sobreContract = new Contract(args.familyContractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(
      sobreContract.call(
        "deposit_from_xlm",
        Address.fromString(kp.publicKey()).toScVal(),
        nativeToScVal(args.relayXlmStroops, { type: "i128" }),
        nativeToScVal(args.split.groceries, { type: "i128" }),
        nativeToScVal(args.split.tuition, { type: "i128" }),
        nativeToScVal(args.split.savings, { type: "i128" }),
      ),
    )
    .setTimeout(30)
    .build();

  // prepareTransaction runs simulation + populates Soroban footprint,
  // auth entries, and resource fees. The Soroswap sub-invocation
  // Sobre performs is authorized via `authorize_as_current_contract`
  // inside the contract, so the outer tx only needs the relay's
  // signature to satisfy the `from.require_auth()` at the top.
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(
      `relay deposit_from_xlm ERROR: ${JSON.stringify(sent.errorResult?.toXDR("base64") ?? sent)}`,
    );
  }

  const hash = sent.hash;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await server.getTransaction(hash);
    if (status.status === "SUCCESS") return hash;
    if (status.status === "FAILED") {
      throw new Error(
        `relay deposit_from_xlm FAILED on chain: ${JSON.stringify(decodeResultXdr(status))}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`relay deposit_from_xlm ${hash} did not confirm within 30s`);
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

/**
 * Submit a classic Stellar `payment` op from the relay to a destination
 * G-address, with a required `memo_id`. This is the OUTBOUND leg of the
 * cashout pipeline: PDAX's deposit address can't receive a Soroban SAC
 * call (their accounting only sees classic payment ops), and the memo is
 * what attributes the deposit to the institution account. Without it the
 * XLM lands at PDAX but isn't credited to anyone — funds stranded.
 *
 * `stroops` is the native XLM amount in stroops. Returns the tx hash on
 * Horizon-confirmed success. Throws on submit/timeout failures.
 *
 * Why Horizon (not Soroban RPC) for submission: classic payment ops can be
 * submitted through either, but Horizon's `submitTransaction` is the
 * battle-tested path for classic ops and returns simpler error shapes than
 * the RPC's prepareTransaction/getTransaction loop (which is Soroban-shaped).
 */
export async function submitClassicPayment(args: {
  destinationG: string;
  stroops: bigint;
  memoId: string;
}): Promise<string> {
  const kp = getRelayKeypair();
  const server = getServer();

  const account = await server.getAccount(kp.publicKey());
  const amountXlm = (Number(args.stroops) / STROOPS_PER_TOKEN).toFixed(7);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(
      Operation.payment({
        destination: args.destinationG,
        asset: Asset.native(),
        amount: amountXlm,
      }),
    )
    .addMemo(Memo.id(args.memoId))
    .setTimeout(30)
    .build();

  tx.sign(kp);

  // Horizon path — classic payment, no Soroban auth dance. Submit via
  // Horizon's REST endpoint directly so we don't pull a SDK that doesn't
  // ship a top-level Horizon.Server in v14.
  const horizonResp = await fetch(`${NETWORK.horizonUrl}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: tx.toEnvelope().toXDR("base64") }),
  });
  const horizonText = await horizonResp.text();
  let horizonBody: unknown;
  try {
    horizonBody = JSON.parse(horizonText);
  } catch {
    horizonBody = horizonText;
  }
  if (!horizonResp.ok) {
    throw new Error(
      `relay classic payment failed (${horizonResp.status}): ${JSON.stringify(horizonBody)}`,
    );
  }
  const hash = (horizonBody as { hash?: string }).hash;
  if (!hash) {
    throw new Error(
      `relay classic payment returned no hash: ${JSON.stringify(horizonBody)}`,
    );
  }
  return hash;
}
