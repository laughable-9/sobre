/**
 * Types + helpers shared by the PDAX deposit/withdraw routes. Keeps the
 * raw PDAX response shapes in one place so route handlers can stay terse.
 */

import "server-only";

import { NETWORK, PAYMENT_TOKEN, STROOPS_PER_TOKEN } from "@/lib/config";
import { pdaxFetch } from "@/lib/pdax/client";
import { getRelayPublicKey, transferFromRelay } from "@/lib/relay";

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
  currency: "XLM" | "USDC";
}> {
  const currency = PAYMENT_TOKEN;
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
  // Net = trade amount - PDAX fee (0.02 XLM flat for XLM). The relay
  // receives this exact amount; we forward it onward in phase 2.
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
  destinationAddress: string;
  expectedNetAmount: number;
  /** ISO timestamp from the pdax_deposits row. Used as the lower bound
   *  when searching Horizon for the incoming payment — prevents matching
   *  an old payment from a previous deposit at the same amount. */
  kickedOffAt: string;
  /** Atomic claim. Caller flips withdraw_tx_hash from NULL to a sentinel
   *  on the row; returns true if THIS poll won the race, false if another
   *  concurrent poll already claimed and is mid-SAC-transfer. Without
   *  this guard the modal's 1s polling can double-send because the SAC
   *  transfer itself takes ~5s to confirm. */
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

  const stroops = BigInt(Math.round(horizonHit.amount * STROOPS_PER_TOKEN));
  const sacTransferHash = await transferFromRelay(
    args.destinationAddress,
    stroops,
  );
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
    method: "instapay_upay_cashin",
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
