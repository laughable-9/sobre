/**
 * Types + helpers shared by the PDAX deposit/withdraw routes. Keeps the
 * raw PDAX response shapes in one place so route handlers can stay terse.
 */

import "server-only";

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

/** PDAX `POST /crypto/withdraw` response. */
export interface PdaxCryptoWithdrawResponse {
  data: {
    transaction_id: string;
    identifier?: string;
    currency: string;
    amount: string | number;
    address: string;
    total?: string | number;
    fee?: string | number;
    status: "IN PROGRESS" | "completed" | "failed";
  };
  status: string;
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

/** Build the heavy `/fiat/deposit` request body. PDAX's required fields
 *  are mostly KYC/Travel-Rule shaped; for the hackathon demo we use the
 *  sender's Google profile + sensible defaults (purpose "Family Support",
 *  source "Compensation", self-beneficiary). */
export function buildFiatDepositBody(args: {
  amountPhp: number;
  identifier: string;
  senderFirstName: string;
  senderLastName: string;
  senderMiddleName?: string;
}) {
  return {
    amount: String(args.amountPhp),
    method: "instapay_upay_cashin",
    identifier: args.identifier,
    currency: "PHP",
    sender_first_name: args.senderFirstName,
    sender_middle_name: args.senderMiddleName ?? "",
    sender_last_name: args.senderLastName,
    sender_country_origin: "Philippines",
    source_of_funds: "Compensation",
    beneficiary_first_name: args.senderFirstName,
    beneficiary_middle_name: args.senderMiddleName ?? "",
    beneficiary_last_name: args.senderLastName,
    purpose: "Family Support",
    relationship_of_sender_to_beneficiary: "Myself",
    nature_of_business: "Allowances",
  };
}
