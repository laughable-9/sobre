/**
 * One-shot: give the relay G-address a trustline to Circle testnet USDC.
 *
 * Sub-account cashout does a SAC `transfer` from the sub's contract to
 * the relay G-address. USDC on Stellar is a classic asset, so the SAC
 * falls through to a classic payment and the receiver needs a trustline.
 * Without it the tx traps with:
 *
 *   HostError: Error(Contract, #13)
 *   "trustline entry is missing for account <relay-G>"
 *
 * Deposit flows are unaffected because those go via XLM (native, no
 * trustline required) and the on-chain contract swaps XLM → USDC via
 * Soroswap for the user. It's only the cashout leg — where PDAX
 * expects USDC arriving at the relay — that needs this.
 *
 * Usage:
 *   cd web
 *   npm run bootstrap:relay-usdc-trustline
 *
 * Reads RELAY_G_SECRET from .env.local (same source lib/env.ts uses
 * server-side). Idempotent — if the trustline already exists, Stellar
 * returns success with the tx as a no-op change.
 *
 * MAINNET: swap USDC_ISSUER for GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 * and point NETWORK at Horizon mainnet + passphrase. See docs/feature-backlog.md
 * §"Mainnet promotion checklist".
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const NETWORK = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  passphrase: Networks.TESTNET,
};

const USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function loadDotEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // No .env.local — assume caller passed env vars directly.
  }
}

async function main() {
  loadDotEnvLocal();
  const secret = process.env.RELAY_G_SECRET;
  if (!secret) {
    console.error(
      "RELAY_G_SECRET missing. Run from web/ with .env.local present, or export it manually.",
    );
    process.exit(1);
  }

  const kp = Keypair.fromSecret(secret);
  const relayG = kp.publicKey();
  console.log(`Relay G-address: ${relayG}`);
  console.log(`USDC issuer:     ${USDC_ISSUER}`);

  const horizon = new Horizon.Server(NETWORK.horizonUrl);
  const account = await horizon.loadAccount(relayG);

  const usdc = new Asset("USDC", USDC_ISSUER);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(60)
    .build();
  tx.sign(kp);

  console.log("Submitting change-trust…");
  const res = await horizon.submitTransaction(tx);
  console.log(`Done. Tx hash: ${res.hash}`);
  console.log(
    `Explorer: https://stellar.expert/explorer/testnet/tx/${res.hash}`,
  );
}

main().catch((e) => {
  const body =
    e?.response?.data?.extras?.result_codes ??
    e?.response?.data ??
    e?.message ??
    e;
  console.error("Trustline bootstrap failed:", body);
  process.exit(1);
});
