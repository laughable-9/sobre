/**
 * Types + helpers shared by the PDAX deposit/withdraw routes. Keeps the
 * raw PDAX response shapes in one place so route handlers can stay terse.
 */

import "server-only";

import { NETWORK, STROOPS_PER_TOKEN } from "@/lib/config";
import { pdaxFetch } from "@/lib/pdax/client";
import {
  depositFromXlmToSobre,
  getRelayPublicKey,
} from "@/lib/relay";
import { splitAmount } from "@/lib/split";

/** PDAX `POST /fiat/deposit` response (relevant fields). */
export interface PdaxFiatDepositResponse {
  request_id: string;
  identifier: string;
  reference_number: string;
  amount: number;
  method: string;
  payment_checkout_url: string;
  fee: number;
  status: "PENDING" | "COMPLETED" | "FAILED" | "IN-PROGRESS";
}

/** PDAX `POST /trade/quote` response. */
export interface PdaxQuoteResponse {
  data: {
    quote_id: string;
    quote_currency: string;
    base_currency: string;
    side: "buy" | "sell";
    base_quantity: string | number;
    price: number;
    total_amount: number;
  };
  status: string;
}

/** PDAX `POST /trade` response. */
export interface PdaxTradeResponse {
  data: {
    order_id: number;
    status: "successful" | "failed" | "IN PROGRESS";
    quote_currency: string;
    base_currency: string;
    side: "buy" | "sell";
    base_quantity: number;
    price: number;
    total_amount: number;
  };
  status: string;
}

/** PDAX `POST /crypto/withdraw` response. Unlike the trade endpoints,
 *  the fields are at the top level (no `data` envelope). `transaction_id`
 *  is a number, not a string. Response is the order acknowledgement —
 *  actual on-chain delivery happens async (poll /crypto/transactions). */
export interface PdaxCryptoWithdrawResponse {
  identifier?: string;
  transaction_id: number;
  currency: string;
  amount: string | number;
  address: string;
  total?: string | number;
  fee?: string | number;
  status: "IN PROGRESS" | "completed" | "failed";
  created_at?: string;
}

/** PDAX webhook payload (fiat variant). */
export interface PdaxFiatWebhook {
  identifier: string;
  user_id?: string;
  request_id: string;
  reference_number: string;
  amount: number;
  asset: "PHP";
  asset_type: "FIAT";
  transaction_type: "DEPOSIT" | "WITHDRAWAL";
  status: "IN-PROGRESS" | "COMPLETED" | "FAILED";
  method: string;
  fee: number;
}

/** PDAX webhook payload (crypto variant). */
export interface PdaxCryptoWebhook {
  identifier: string;
  user_id?: string;
  reference_id: string;
  request_id: string;
  transaction_type: "DEPOSIT" | "WITHDRAWAL";
  transaction_hash: string;
  amount: number;
  fee_amount: number;
  asset: string;
  asset_type: "crypto";
  network: string;
  source_address: string;
  source_address_tag?: string;
  destination_address: string;
  destination_address_tag?: string;
  status: "completed" | "failed";
}

export type PdaxWebhookPayload = PdaxFiatWebhook | PdaxCryptoWebhook;

export function isFiatWebhook(p: PdaxWebhookPayload): p is PdaxFiatWebhook {
  return p.asset_type === "FIAT";
}

export function isCryptoWebhook(p: PdaxWebhookPayload): p is PdaxCryptoWebhook {
  return p.asset_type === "crypto";
}

/**
 * Phase 1 of the deposit pipeline: PHP → token trade + /crypto/withdraw to
 * the relay G-address. Returns once PDAX has ACK'd the withdraw order,
 * does NOT wait for on-chain settlement. The caller marks the row `funded`
 * and lets the polling loop drive phase 2.
 *
 * Why split it: PDAX's withdraw API returns "IN PROGRESS" immediately but
 * actual classic-Stellar settlement takes ~10-30s, and their internal
 * `status` field doesn't flip to `completed` even after the XLM has
 * arrived on chain. Hanging the route on either signal was unreliable.
 *
 * The relay step exists because PDAX's chain leg uses classic Stellar
 * `payment` ops, which can't target a Soroban contract address. Sending
 * directly to a C-address returns 200 then silently fails async. See
 * `lib/relay.ts`.
 */
export async function kickOffPdaxWithdraw(args: {
  identifier: string;
  amountPhp: number;
}): Promise<{
  amountToken: number;
  netAmount: number;
  pdaxWithdrawTxId: number;
  currency: "XLM";
}> {
  // Always trade + withdraw XLM regardless of Sobre's on-chain payment
  // token. The on-chain `deposit_from_xlm` swaps XLM → payment token via
  // Soroswap after the relay receives the XLM. PDAX UAT can't buy
  // USDCXLM directly (OT010016 "Asset unavailable" on `quote_currency=USDCXLM`),
  // and USDC via PDAX credits a Circle-ERC20 bucket with the wrong step
  // size for the network we settle on. Hardcoded XLM sidesteps both.
  const currency = "XLM" as const;
  const relayG = getRelayPublicKey();

  const quote = await pdaxFetch<PdaxQuoteResponse>(
    "/pdax-institution/v1/trade/quote",
    {
      method: "POST",
      body: {
        side: "buy",
        quote_currency: currency,
        base_currency: "PHP",
        base_quantity: String(args.amountPhp),
      },
    },
  );

  const trade = await pdaxFetch<PdaxTradeResponse>(
    "/pdax-institution/v1/trade",
    {
      method: "POST",
      body: {
        quote_id: quote.data.quote_id,
        side: "buy",
        idempotency_id: args.identifier,
      },
    },
  );
  const amountToken = Number(trade.data.base_quantity);

  const withdraw = await pdaxFetch<PdaxCryptoWithdrawResponse>(
    "/pdax-institution/v1/crypto/withdraw",
    {
      method: "POST",
      body: {
        identifier: args.identifier,
        currency,
        amount: String(amountToken),
        address: relayG,
        beneficiary_wallet: "true",
        send_to_self: "true",
      },
    },
  );
  // Net = trade amount - PDAX's 0.02 XLM flat withdraw fee. The relay
  // receives this exact amount; the on-chain swap in phase 2 turns it
  // into USDC.
  const netAmount = withdraw.amount !== undefined
    ? Number(withdraw.amount)
    : amountToken;

  return {
    amountToken,
    netAmount,
    pdaxWithdrawTxId: withdraw.transaction_id,
    currency,
  };
}

/**
 * Phase 2: one-shot check whether PDAX's withdraw has landed and, if so,
 * forward the funds from the relay to the user's smart wallet via SAC
 * transfer. Returns the resolved state — caller updates the row and either
 * returns (still pending) or transitions to `credited`.
 *
 * Completion signal is Horizon-visible: a payment to the relay since
 * `kickedOffAt`, amount matching expectedNetAmount within 0.01 XLM,
 * asset = native XLM. PDAX's own `status` field on /crypto/transactions
 * lags by minutes (it can still say `pending` long after the XLM has
 * settled on chain), so we don't rely on it. Horizon is the truth.
 */
export async function tryCompleteWithdrawAndTransfer(args: {
  identifier: string;
  /** Family Sobre contract's C-address. `deposit_from_xlm` runs on this
   *  contract — envelopes get credited directly, no user-signed follow-up
   *  step. */
  familyContractId: string;
  /** Family percentages `[groceries, tuition, savings]` summing to 100.
   *  Server splits the Soroswap payout by these to compute per-envelope
   *  USDC totals passed to the contract. */
  percents: readonly [number, number, number];
  expectedNetAmount: number;
  /** ISO timestamp from the pdax_deposits row. Used as the lower bound
   *  when searching Horizon for the incoming payment — prevents matching
   *  an old payment from a previous deposit at the same amount. */
  kickedOffAt: string;
  /** Atomic claim. Caller flips withdraw_tx_hash from NULL to a sentinel
   *  on the row; returns true if THIS poll won the race, false if another
   *  concurrent poll already claimed and is mid-invoke. Without this
   *  guard the modal's 1s polling can double-send because the
   *  deposit_from_xlm tx itself takes ~5s to confirm. */
  claimSacTransfer: () => Promise<boolean>;
}): Promise<
  | { state: "still_pending" }
  | { state: "completed"; sacTransferHash: string; netAmount: number }
> {
  const horizonHit = await findIncomingPaymentAtRelay({
    expectedAmount: args.expectedNetAmount,
    sinceIso: args.kickedOffAt,
  });
  if (!horizonHit) return { state: "still_pending" };

  const won = await args.claimSacTransfer();
  if (!won) return { state: "still_pending" };

  const xlmStroops = BigInt(Math.round(horizonHit.amount * STROOPS_PER_TOKEN));
  // Split the expected USDC total by family percentages. The contract
  // will validate the sum against Soroswap's actual payout; if the
  // swap under-delivers, the invocation traps and this claim rolls back
  // on the next poll. A small safety margin isn't applied here — the
  // 2% Soroswap slippage floor inside the contract is enough for
  // normal-mainnet-ish rate movement.
  const totalUsdcStroops = BigInt(
    Math.round(args.expectedNetAmount * STROOPS_PER_TOKEN),
  );
  const split = splitAmount(totalUsdcStroops, args.percents);
  const sacTransferHash = await depositFromXlmToSobre({
    familyContractId: args.familyContractId,
    relayXlmStroops: xlmStroops,
    split,
  });
  return {
    state: "completed",
    sacTransferHash,
    netAmount: horizonHit.amount,
  };
}

interface HorizonPayment {
  type: string;
  created_at: string;
  amount?: string;
  asset_type?: string;
  to?: string;
  from?: string;
}

interface HorizonPaymentsResponse {
  _embedded: { records: HorizonPayment[] };
}

/**
 * Query Horizon for the relay's most-recent incoming native-XLM payments,
 * look for one received after `sinceIso` matching `expectedAmount` within
 * 0.01 XLM tolerance. PDAX's 0.02 XLM withdraw fee is already netted out
 * by the caller — `expectedAmount` is the post-fee amount the relay
 * actually receives.
 */
async function findIncomingPaymentAtRelay(args: {
  expectedAmount: number;
  sinceIso: string;
}): Promise<{ amount: number } | null> {
  const relayG = getRelayPublicKey();
  const url = `${NETWORK.horizonUrl}/accounts/${relayG}/payments?order=desc&limit=20`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const body = (await resp.json()) as HorizonPaymentsResponse;
  const since = new Date(args.sinceIso).getTime();
  for (const p of body._embedded.records) {
    if (p.type !== "payment") continue;
    if (p.asset_type !== "native") continue;
    if (p.to !== relayG) continue;
    const tsMs = new Date(p.created_at).getTime();
    if (tsMs < since) continue;
    const amount = Number(p.amount);
    if (Math.abs(amount - args.expectedAmount) < 0.01) {
      return { amount };
    }
  }
  return null;
}

/** Travel-Rule defaults shared by /fiat/deposit + /fiat/withdraw bodies.
 *  PDAX requires every field non-empty even at sub-50k amounts; these
 *  values are the OFW-remittance shape we use across the demo. The hyphen
 *  middle-name placeholder is what PDAX accepts when the upstream profile
 *  doesn't surface a real one. */
export const TRAVEL_RULE_DEFAULTS = {
  sender_country_origin: "Philippines",
  source_of_funds: "Compensation",
  purpose: "Family Support",
  relationship_of_sender_to_beneficiary: "Myself",
  nature_of_business: "Allowances",
} as const;

export const MIDDLE_NAME_FALLBACK = "-";

/** Shape of PDAX's /fiat/transactions rows (the bits we read). Both the
 *  deposit and withdraw poll-status routes match by `identifier`. The
 *  `mode` distinguishes deposit (CashIn) from withdraw (CashOut). */
export interface PdaxFiatTransaction {
  identifier: string;
  status: "IN-PROGRESS" | "COMPLETED" | "FAILED";
  amount?: string | number;
  mode?: "CashIn" | "CashOut";
}

export interface PdaxFiatTransactionsResponse {
  data: PdaxFiatTransaction[];
  status: string;
}

/** Look up a single transaction in PDAX's /fiat/transactions index by
 *  identifier. Returns undefined when PDAX hasn't surfaced the tx yet
 *  (their reporting endpoint lags actual settlement by a few seconds).
 *  Used in every place where we need to learn the live PDAX status for
 *  a deposit or cashout — cancel pre-check, poll-status drivers, and
 *  the /active resurrect pass.
 *
 *  Throws on transport errors so callers can decide whether to bail or
 *  fall through. */
export async function getPdaxFiatTx(
  identifier: string,
  mode: "CashIn" | "CashOut",
): Promise<PdaxFiatTransaction | undefined> {
  const resp = await pdaxFetch<PdaxFiatTransactionsResponse>(
    "/pdax-institution/v1/fiat/transactions",
    { query: { identifier, mode, page: 1, pageSize: 10 } },
  );
  return resp.data.find((t) => t.identifier === identifier);
}

/** Build the heavy `/fiat/deposit` request body. PDAX's required fields
 *  are mostly KYC/Travel-Rule shaped; for the hackathon demo we use the
 *  sender's Google profile + sensible defaults. */
export function buildFiatDepositBody(args: {
  amountPhp: number;
  identifier: string;
  senderFirstName: string;
  senderLastName: string;
  senderMiddleName?: string;
}) {
  const middle = args.senderMiddleName?.trim() || MIDDLE_NAME_FALLBACK;
  return {
    amount: String(args.amountPhp),
    // `instapay_upay_cashin` and `ub_online_upay_cashin` both route to
    // UnionBank's UPay gateway (ubotpsentry-tst1.outsystemsenterprise.com),
    // which is currently down on UnionBank's side — PDAX support confirmed
    // ("may problem yung upay"). Our cash-ins were timing out because
    // payment never landed at the broken checkout page. GrabPay uses Grab's
    // debit-pull backend (different processor) and works end-to-end. Flip
    // back when PDAX confirms UPay is restored.
    method: "grabpay_cashin",
    identifier: args.identifier,
    currency: "PHP",
    sender_first_name: args.senderFirstName,
    sender_middle_name: middle,
    sender_last_name: args.senderLastName,
    beneficiary_first_name: args.senderFirstName,
    beneficiary_middle_name: middle,
    beneficiary_last_name: args.senderLastName,
    ...TRAVEL_RULE_DEFAULTS,
  };
}
