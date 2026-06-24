/**
 * Hardcoded constants for the demo. Contract IDs are public; the testnet
 * network passphrase is fixed.
 */

/**
 * SobreFactory contract — the singleton that deploys per-family SobreContract
 * instances. Each family gets their own contract address; this address is
 * only the entry point for opening new ones + listing the user's wallets.
 *
 * Testnet is the live deployment the web app talks to. Mainnet factory
 * `CBXBBFCFVDGJANUAQUJG7I6YQ5YV7SSUM4QXB4ZCQYZ7VXAM4O3NIAUO` is also
 * deployed as proof-of-production; flip FACTORY_CONTRACT_ID + NETWORK
 * together to switch environments.
 */
export const FACTORY_CONTRACT_ID =
  "CCPPCLVRQO7LPRHLGH7KXWZFSCXGODVZD7VAZOCV5JVDSWQ4NMZMBT2X";

/** XLM native Stellar Asset Contract (the SEP-41 wrapper around native XLM).
 *  Deterministic per network — different address per network because the SAC
 *  derivation hashes the network passphrase.
 *  Testnet: CDLZFC3S... | Mainnet: CAS3J7GY... (kept here for reference) */
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

/**
 * passkey-kit pre-uploaded testnet artifact. The smart-wallet contract
 * WASM is shared across every passkey-kit user on testnet — Sobre does
 * not deploy this WASM, just instantiates new contracts per user with
 * the user's passkey as the secp256r1 signer.
 *
 * Verification is inline in the wallet contract (no separate WebAuthn
 * verifier contract like OZ smart-account-kit needs).
 *
 * Mainnet uses a different hash; flip alongside FACTORY_CONTRACT_ID +
 * NETWORK when promoting to mainnet.
 */
export const PASSKEY_KIT = {
  walletWasmHash:
    "ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90",
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
