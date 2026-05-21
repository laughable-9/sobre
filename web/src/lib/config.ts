/**
 * Hardcoded constants for the demo. Phase 5 doesn't bother with env vars —
 * the contract ID is public and the testnet network passphrase is fixed.
 */

export const CONTRACT_ID = "CAQ4CUGKAQL67CV5OUXUUGCCZDMFZSRWZOCOIXOF7LK666W7A6YF3CUD";

/** XLM native Stellar Asset Contract (the SEP-41 wrapper around native XLM).
 *  Deterministic per network. On testnet it's always this address. */
export const XLM_SAC_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const NETWORK = {
  /** Name returned by Freighter's getNetwork(). */
  name: "TESTNET",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
} as const;

/** Stellar's native unit is the stroop. 1 XLM = 10,000,000 stroops. */
export const STROOPS_PER_XLM = 10_000_000;

/** Fixed XLM → PHP rate for the demo. Real impl would poll CoinGecko. */
export const PHP_PER_XLM = 16;

export const ENVELOPE_LABELS = ["Groceries", "Tuition", "Savings"] as const;
export type EnvelopeName = (typeof ENVELOPE_LABELS)[number];
