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

/** Public path for the Sobre logo asset. Referenced from every splash /
 *  header / OG-image site; keeping it here means the next brand
 *  refresh is a one-line edit instead of a grep-and-replace.
 *
 *  `LOGO_FILENAME` is the bare name (no leading slash) so Node-side
 *  callers (OG image) can `join(process.cwd(), "public", ...)`.
 *  `LOGO_SRC` is the browser-facing HTTP path for `<Image src>` etc. */
export const LOGO_FILENAME = "newlogo.svg";
export const LOGO_SRC = `/${LOGO_FILENAME}`;

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
export const PAYMENT_TOKEN = "USDC" as PaymentToken;

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
 * Blend Protocol v2 TestnetV2 pool + XLM reserve asset for the **Grow**
 * feature. When admin enables Grow, these get passed to
 * `grow_enable(pool, xlm_asset, soroswap_router)` alongside Soroswap.
 *
 * Grow's flow: the Sobre contract holds USDC (payment token), but Blend's
 * testnet pool's XLM reserve is what has liquidity — Grow supply swaps
 * USDC→XLM via Soroswap first, then supplies XLM to Blend. Withdraw
 * reverses. See earn-grow-research.md § "Blend Protocol" and the
 * 2026-07-12 pivot in feature-backlog.md for the reasoning.
 *
 * Pool sourced from `github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json`
 * (the `TestnetV2` entry). If Blend rotates the pool, update here.
 *
 * For mainnet promotion: on mainnet, Blend's USDC reserve accepts Circle
 * USDC (same issuer as Sobre's payment token), so the Soroswap sandwich
 * may become unnecessary — supply Circle USDC directly to Blend USDC
 * reserve. Verify at cut time. See feature-backlog.md "Mainnet promotion".
 */
export const BLEND_POOL_ID: string =
  "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF";
export const BLEND_ASSET_ID: string = XLM_SAC_ID;

/**
 * Soroswap router contract on testnet. Used by Grow (in-contract) to
 * swap USDC↔XLM around the Blend supply/withdraw legs. Real testnet pool
 * has ~$450K USDC + 3.6M XLM depth at mainnet-ish price (0.123 USDC/XLM
 * as of 2026-07-12) — enough for hundreds of demo deposits.
 *
 * Mainnet path: swap for Soroswap mainnet router if we keep the sandwich,
 * or drop entirely if Blend USDC reserve accepts Circle USDC directly.
 */
export const SOROSWAP_ROUTER_ID: string =
  "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

/**
 * MockUSDY contract on testnet. Sobre's Earn envelope calls this contract's
 * `deposit` / `redeem` / `balance_of`. Interface matches Ondo's real USDY
 * so mainnet swap is a single address change.
 *
 * Deployed 2026-07-12 with wasm hash
 * `9f543de035faaad0bc85f6071b1c8917aa8739e9ea69580876e0e140efaf81d6`
 * and initialised with Circle testnet USDC as underlying.
 */
export const MOCK_USDY_ID: string =
  "CCHFSDJIBR2YCGCNQ4IRYPPOQXG562LKBHDRCJL5TWBAI3RZ5G6ZALHA";

/**
 * User-facing APY pill copies. Earn (USDY) and Grow (Blend lending) have
 * different risk/rate profiles per the PM's SEC-disclosure ask — never
 * label both with a single "APY". Blend rates fluctuate with pool
 * utilization; USDY tracks a short-term US Treasuries basket via Ondo.
 *
 * These are aspirational-but-honest copy for the demo. Once real yield
 * feeds land (Blend rate model live via RPC, Ondo USDY on Stellar), swap
 * for computed values. Do NOT use "guaranteed" / "fixed" language —
 * that's a compliance flag for a Philippine fintech.
 */
export const EARN_APY_LABEL = "~5% p.a.";
export const GROW_APY_LABEL = "variable";

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
  // Protocol-27-compatible smart-wallet wasm published by kalepail
  // alongside passkey-kit 0.14 (README recommends this exact hash).
  // The prior 0.12-era hash `ecd990f0…c4cd90` is still deployed on
  // testnet but testnet's protocol-27 upgrade rejects new deploys
  // against it (submit fails with unknown TransactionResultCode).
  // Existing users on the old hash aren't affected — they connect,
  // not signup. Only fresh signups touch this constant.
  walletWasmHash:
    "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0",
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

/** InstaPay service fee PDAX charges per fiat withdraw. Observed as ₱15
 *  flat on UAT (₱100 payout, ₱115 debited from institutional PHP
 *  balance). We surface this on the cashout modal and cover it by
 *  increasing the on-chain USDC spend, so the amount the user typed is
 *  what actually lands in their bank. Mainnet may tier by bank —
 *  pull the production fee schedule at cut time and swap this const
 *  (or convert to a function of bank_code). See docs/feature-backlog.md
 *  §"InstaPay service fee on cashouts". */
export const PDAX_INSTAPAY_FEE_PHP = 15;

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
