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
  "CAGQNXTXW422Q5RJP2AE3LZ3CGCSKPMUAWCPAVW6YGOPFDUU33TQFHAZ";

/**
 * USDC on Stellar — the SEP-41 SAC for Circle's testnet USDC.
 *
 * Testnet issuer (Circle): `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
 * Mainnet USDC SAC needs to be re-resolved against Circle's mainnet issuer
 * `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` when promoting.
 */
export const USDC_SAC_ID =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/**
 * XLM native SAC on testnet. Same address every deploy (deterministic).
 * Fetch on any network with `stellar contract id asset --asset native`.
 */
export const XLM_SAC_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/**
 * Payment-token switch. The Sobre contract's `init(payment_token)` is
 * token-agnostic — every new family wallet bakes its choice at deploy time
 * (it can't change after init). This single const decides which asset new
 * deploys use; all PDAX routes + family-wallet code read from it.
 *
 * "XLM" — the only PDAX UAT path that works end-to-end right now.
 *   - PDAX trades PHP↔XLM (works).
 *   - PDAX `/crypto/withdraw` delivers XLM to Stellar G/C addresses.
 *
 * "USDC" — preferred stablecoin path. Blocked in PDAX UAT today:
 *   - PDAX rejects `quote_currency=USDCXLM` on /trade/quote (OT010016
 *     "Asset unavailable") on both v1 and v2.
 *   - The `USDC` bucket trades land in is the ERC-20 USDC bucket — there's
 *     no documented USDC→USDCXLM bridge endpoint, and no PHP↔USDCXLM pair.
 *   Flip back to "USDC" the moment PDAX support fixes the bucket bridge or
 *   enables the PHP↔USDCXLM market.
 */
export type PaymentToken = "XLM" | "USDC";

/** Cast away the literal narrowing so downstream comparisons against
 *  "USDC" don't trip TS2367 ("comparison appears unintentional"). The
 *  ternary below should remain meaningful — flipping the literal here
 *  cascades to PAYMENT_TOKEN_SAC_ID without touching call sites. */
export const PAYMENT_TOKEN = "XLM" as PaymentToken;

/** The SAC contract ID passed to every new family wallet's `init` as
 *  `payment_token`. Drives `deposit` / `spend` / SAC `transfer`. */
export const PAYMENT_TOKEN_SAC_ID: string =
  PAYMENT_TOKEN === "USDC" ? USDC_SAC_ID : XLM_SAC_ID;

/** User-visible label for the payment token. Read this anywhere UI
 *  copy needs to say "XLM" / "USDC" so a future token swap is a
 *  one-line change in this file, not a 9-site sweep. */
export const PAYMENT_TOKEN_LABEL: string = PAYMENT_TOKEN;

/** Origin used in invite URLs the admin shares. Hardcoded to the deployed
 *  domain so a link generated from `localhost:3000` during local dev still
 *  resolves to the production app when the recipient opens it. */
export const APP_ORIGIN = "https://sobre-mocha.vercel.app";

/** Defensive client-side ceiling for `family_wallets.admin_cap`. The DB
 *  CHECK guards `>= 1` only, but the household model tops out well before
 *  this — 5 keeps the UI validation honest without artificially blocking
 *  a rare use-case. Bump here if the model ever widens; the input min/max
 *  in the cap editor reads from this. */
export const MAX_ADMIN_CAP = 5;

/**
 * Blend Protocol v2 TestnetV2 pool + asset addresses for the Earn feature.
 * When admin enables Earn, these get passed to `earn_enable(pool, asset)`.
 *
 * Pool sourced from `github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json`
 * (the `TestnetV2` entry). If Blend rotates the pool, update here.
 * Asset is Sobre's payment token — XLM native SAC on testnet — which is
 * a live reserve on the TestnetV2 pool at reserve index 0.
 *
 * For mainnet promotion: use the mainnet USDC-oriented pool from
 * `docs.blend.capital/mainnet-deployments` and switch the asset to the
 * mainnet USDC SAC (once the PDAX↔USDC path lands per project_payment_token_usdc).
 */
export const BLEND_POOL_ID: string =
  "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF";
export const BLEND_ASSET_ID: string = XLM_SAC_ID;

/**
 * User-facing APY pill copy shown on the Savings envelope strip, the
 * Grow panel, and the home-tab Yield summary. Testnet b_rate spikes make
 * a live-computed number look wrong in a pitch ("~256% p.a." was seen
 * during Step 5 verification); an aspirational hardcode is honest for
 * the demo. Swap for a live compute against Blend's rate model once the
 * mainnet flip lands. */
export const EARN_APY_LABEL = "up to 3.5% p.a.";

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
 *  Both USDC and XLM use 7-decimal precision, so 1 token = 10,000,000 stroops
 *  regardless of which payment token the family wallet was initialised with. */
export const STROOPS_PER_TOKEN = 10_000_000;

/** Back-compat alias. Kept so older call sites keep working while the
 *  codebase migrates to STROOPS_PER_TOKEN. */
export const STROOPS_PER_USDC = STROOPS_PER_TOKEN;

/** First-paint fallback for PHP per token. Live rate comes from
 *  `GET /api/pdax/price` (which proxies PDAX's `/v1/trade/price`). Values
 *  here are roughly today's PDAX UAT indicative rates so the modal doesn't
 *  flash an obviously-wrong number before the live rate lands. */
export const PHP_PER_TOKEN_FALLBACK: Record<"XLM" | "USDC", number> = {
  XLM: 7.575,
  USDC: 62.205,
};

/** Back-compat alias. PHP_PER_USDC was hardcoded everywhere; now resolves
 *  from the active token's fallback constant. Reads only — components should
 *  prefer the live rate from `useTokenRate()`. */
export const PHP_PER_USDC = PHP_PER_TOKEN_FALLBACK[PAYMENT_TOKEN];

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
