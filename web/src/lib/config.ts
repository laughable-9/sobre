/**
 * Hardcoded constants for the demo. Contract IDs are public; the testnet
 * network passphrase is fixed.
 */

/**
 * SobreFactory contract — the singleton that deploys per-family SobreContract
 * instances. Each family gets their own contract address; this address is
 * only the entry point for opening new ones + listing the user's wallets.
 *
 * Mainnet is the live production deployment the web app talks to. Testnet
 * factory `CCPPCLVRQO7LPRHLGH7KXWZFSCXGODVZD7VAZOCV5JVDSWQ4NMZMBT2X` is kept
 * around as a sandbox; flip FACTORY_CONTRACT_ID + NETWORK together to
 * switch environments.
 */
export const FACTORY_CONTRACT_ID =
  "CBXBBFCFVDGJANUAQUJG7I6YQ5YV7SSUM4QXB4ZCQYZ7VXAM4O3NIAUO";

/** XLM native Stellar Asset Contract (the SEP-41 wrapper around native XLM).
 *  Deterministic per network — different address per network because the SAC
 *  derivation hashes the network passphrase.
 *  Mainnet: CAS3J7GY... | Testnet: CDLZFC3S... (kept here for reference) */
export const XLM_SAC_ID =
  "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

/** Origin used in invite URLs the admin shares. Hardcoded to the deployed
 *  domain so a link generated from `localhost:3000` during local dev still
 *  resolves to the production app when the recipient opens it. */
export const APP_ORIGIN = "https://sobre-mocha.vercel.app";

export const NETWORK = {
  /** Name returned by Freighter's getNetwork(). */
  name: "PUBLIC",
  passphrase: "Public Global Stellar Network ; September 2015",
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org",
} as const;

/** Stellar's native unit is the stroop. 1 XLM = 10,000,000 stroops. */
export const STROOPS_PER_XLM = 10_000_000;

/** Fallback XLM → PHP rate. Used until CoinGecko comes back (or if it
 *  fails). Live rate is fetched + cached by lib/usePhpPerXlm. */
export const PHP_PER_XLM = 16;

export const ENVELOPE_LABELS = ["Groceries", "Tuition", "Savings"] as const;
export type EnvelopeName = (typeof ENVELOPE_LABELS)[number];

/** Map a canonical envelope slot to its current display label.
 *  `envelopeNames` comes from get_state; falls back to the slot key when the
 *  state hasn't loaded yet or the array is malformed. */
export function displayEnvelopeName(
  canonical: string,
  envelopeNames: string[] | undefined,
): string {
  if (!envelopeNames) return canonical;
  const i = ENVELOPE_LABELS.indexOf(canonical as EnvelopeName);
  if (i < 0) return canonical;
  return envelopeNames[i] ?? canonical;
}
