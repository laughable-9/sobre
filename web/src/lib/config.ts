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

/**
 * USDC on Stellar — the SEP-41 SAC for Circle's testnet USDC. Sobre's
 * payment token: every new family-wallet `init` passes this as the
 * `payment_token` arg. `deposit` / `spend` / SAC `transfer` all operate
 * against this contract.
 *
 * Testnet issuer (Circle): `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
 * Mainnet USDC SAC needs to be re-resolved against Circle's mainnet issuer
 * `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` when promoting.
 */
export const USDC_SAC_ID =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** Alias used by `createFamilyWallet`. Names the role rather than the
 *  asset so a future swap is one-line at the config layer. */
export const PAYMENT_TOKEN_SAC_ID = USDC_SAC_ID;

/**
 * XLM native SAC — kept for the 3 pre-USDC family wallets Kyle deployed
 * during Phase 5/6 dev (CDWN4CWY…, CACIPCTW…, CD7IGLTX…). New family
 * wallets use USDC; these legacy XLM ones still load but display the
 * wrong currency label after the swap. Treat as test detritus.
 */
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

/** Stellar's on-chain unit for SEP-41 tokens is 10^7 sub-units per token.
 *  USDC on Stellar uses 7 decimals just like XLM, so 1 USDC = 10,000,000
 *  stroops. The `stroops` term comes from XLM but applies to any SAC token
 *  using the standard 7-decimal precision. */
export const STROOPS_PER_USDC = 10_000_000;

/** Fallback / demo rate. USDC is stable at $1 so PHP-per-USDC tracks the
 *  USD-PHP rate (mid-2026 spot ~₱58). Hardcoded for the demo; if a live
 *  rate is ever needed, hit PDAX's `/v1/trade/price` instead of CoinGecko. */
export const PHP_PER_USDC = 58;

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
