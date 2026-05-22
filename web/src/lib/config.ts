/**
 * Hardcoded constants for the demo. Contract IDs are public; the testnet
 * network passphrase is fixed.
 */

/**
 * SobreFactory contract — the singleton that deploys per-family SobreContract
 * instances. Each family gets their own contract address; this address is
 * only the entry point for opening new ones + listing the user's wallets.
 */
export const FACTORY_CONTRACT_ID =
  "CCPPCLVRQO7LPRHLGH7KXWZFSCXGODVZD7VAZOCV5JVDSWQ4NMZMBT2X";

/** XLM native Stellar Asset Contract (the SEP-41 wrapper around native XLM).
 *  Deterministic per network. On testnet it's always this address. */
export const XLM_SAC_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** Origin used in invite URLs the admin shares. Hardcoded to the deployed
 *  domain so a link generated from `localhost:3000` during local dev still
 *  resolves to the production app when the recipient opens it. */
export const APP_ORIGIN = "https://sobre-mocha.vercel.app";

export const NETWORK = {
  /** Name returned by Freighter's getNetwork(). */
  name: "TESTNET",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
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
