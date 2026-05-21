"use client";

import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

import { CONTRACT_ID, NETWORK } from "@/lib/config";

let cachedServer: rpc.Server | null = null;
export function getServer(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(NETWORK.rpcUrl);
  return cachedServer;
}

export function getContract(): Contract {
  return new Contract(CONTRACT_ID);
}

/**
 * Build → prepare (simulate + assemble) → Freighter-sign → submit → poll.
 * Returns the tx hash on success; throws with an error message on failure.
 */
export async function invokeWrite(
  method: string,
  args: xdr.ScVal[],
  userAddress: string,
): Promise<string> {
  const server = getServer();
  const contract = getContract();

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
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") {
      throw new Error("tx failed on chain");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("tx not confirmed within 30s");
}

/** Helper to build the ScVal for a `#[contracttype] enum Envelope::X` unit variant. */
export function envelopeScVal(
  variant: "Groceries" | "Tuition" | "Savings",
): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
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
