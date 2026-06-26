/**
 * Server-side helpers for the PDAX cashout pipeline. Mirrors lib/pdax/deposits.ts
 * but reversed: user signs spend() + SAC transfer to relay → server submits
 * classic payment to PDAX (with memo) → server runs sell trade + fiat withdraw
 * to the user's bank.
 *
 * State machine reference:
 *   pending     — user picked envelope+amount+bank, no on-chain action yet
 *   spent       — user's spend() + smart-wallet → relay SAC transfer landed
 *   transferred — relay submitted classic payment to PDAX deposit address
 *                 + PDAX credited the XLM in /crypto/transactions
 *   converted   — PDAX sell-trade ran + /fiat/withdraw initiated
 *   paid        — PDAX /fiat/transactions flipped to COMPLETED
 *   failed      — any step errored
 */

import "server-only";

import { NETWORK, PAYMENT_TOKEN } from "@/lib/config";
import { PdaxError, pdaxFetch } from "@/lib/pdax/client";
import {
  MIDDLE_NAME_FALLBACK,
  TRAVEL_RULE_DEFAULTS,
  type PdaxQuoteResponse,
  type PdaxTradeResponse,
} from "@/lib/pdax/deposits";

/** True when PDAX rejected a write because the idempotency_id was already
 *  used — meaning the operation is already committed on their side and we
 *  can safely skip it on retry. PDAX returns `400 ServerError "Duplicate
 *  Request with ID: <our-uuid>"` on /trade and /fiat/withdraw. Treating
 *  this as success is the only way to make convertAndPayoutPhp retryable
 *  after a mid-pipeline failure. */
function isPdaxDuplicateRequest(e: unknown): boolean {
  if (!(e instanceof PdaxError)) return false;
  if (e.status !== 400) return false;
  const body = e.body;
  if (typeof body !== "object" || body === null) return false;
  const msg =
    "message" in body
      ? String((body as { message: unknown }).message)
      : "error" in body
        ? String((body as { error: unknown }).error)
        : "";
  return msg.toLowerCase().includes("duplicate request");
}

/** PDAX `GET /crypto/deposit?currency=XLM` response. We resolve this once on
 *  withdraw kickoff so the memo + address travel with the row, immune to
 *  PDAX rotating addresses underneath us mid-flight. */
export interface PdaxCryptoDepositAddrResponse {
  data: { currency: string; address: string; tag?: string };
  status: string;
}

/** PDAX `GET /crypto/transactions?type=crypto_in` row. We poll this to detect
 *  that the relay's classic payment has been credited to the institution
 *  balance; match by `transaction_hash` against `transfer_tx_hash` on the row.
 *
 *  PDAX doesn't surface our `identifier` on inbound deposits because the
 *  relay's classic payment doesn't carry it — the memo is reserved for the
 *  numeric `memo_id` that attributes the deposit to the institution account. */
export interface PdaxCryptoInTransaction {
  transaction_hash: string;
  status: "pending" | "completed" | "failed";
  amount?: string | number;
  currency?: string;
  created_at?: string;
}

export interface PdaxCryptoTransactionsResponse {
  data: PdaxCryptoInTransaction[];
  status: string;
}

/** PDAX `GET /crypto/deposit` — fetch the institution's deposit address for
 *  the active payment currency. Returns the G-address + memo_id ("tag" in
 *  PDAX's response). Cached at module load; the address is stable across
 *  the institution's lifetime. */
let cachedDepositAddr: { address: string; memo: string } | null = null;
export async function getPdaxCryptoDepositAddr(): Promise<{
  address: string;
  memo: string;
}> {
  if (cachedDepositAddr) return cachedDepositAddr;
  const resp = await pdaxFetch<PdaxCryptoDepositAddrResponse>(
    "/pdax-institution/v1/crypto/deposit",
    { query: { currency: PAYMENT_TOKEN } },
  );
  const memo = resp.data.tag;
  if (!memo) {
    // PDAX's XLM (and USDCXLM) deposit addresses MUST come with a memo_id —
    // without one, the classic payment hits a shared G-address and isn't
    // attributable. Fail loud so the cashout aborts at kickoff rather than
    // sending funds into a black hole.
    throw new Error(
      "PDAX /crypto/deposit returned no memo tag — refusing to send a classic payment without it",
    );
  }
  cachedDepositAddr = { address: resp.data.address, memo };
  return cachedDepositAddr;
}

/**
 * Phase 2 of the cashout pipeline: sell the credited token back to PHP and
 * fire the fiat withdraw to the user's bank via InstaPay. Mirrors the buy
 * side that `kickOffPdaxWithdraw` runs in the deposit direction.
 *
 * PDAX's `/trade/quote` API has a foot-gun: `base_quantity` must always be
 * in the `base_currency`, which is PHP for both buy and sell. Sending the
 * XLM amount (which is the `quote_currency`) trips `OT010029 "Invalid
 * Quantity Step"` because PDAX expects whole PHP increments. So we pass
 * the user's target PHP amount as base_quantity for both directions.
 *
 * For SELL: PDAX debits `total_amount` quote-currency (XLM) from the
 * institution balance and credits `base_quantity` PHP. The fiat/withdraw
 * call uses the same `amountPhp` so the user receives exactly what they
 * asked for.
 *
 * Note: PDAX UAT rates are wildly off-market (sell rate ~7.27 XLM per PHP).
 * The math works mechanically but the institution's XLM balance burns
 * fast. Production rates are sane; UAT is just for plumbing validation.
 */
export async function convertAndPayoutPhp(args: {
  identifier: string;
  amountPhp: number;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}): Promise<{ totalPhp: number }> {
  const currency = PAYMENT_TOKEN;
  const phpInt = Math.round(args.amountPhp);

  // The quote is cheap and quote_id is short-lived (~60s), so we always
  // fetch a fresh one. The expensive sell-side commit comes next.
  const quote = await pdaxFetch<PdaxQuoteResponse>(
    "/pdax-institution/v1/trade/quote",
    {
      method: "POST",
      body: {
        side: "sell",
        quote_currency: currency,
        base_currency: "PHP",
        base_quantity: String(phpInt),
      },
    },
  );

  // /trade enforces idempotency by rejecting (not deduping) repeat
  // idempotency_ids. On a retry after /fiat/withdraw failed mid-pipeline,
  // the trade is already booked on PDAX's side — swallow the dup-rejection
  // and continue. The XLM debit happened once; the PHP credit is sitting
  // in our institution balance.
  try {
    await pdaxFetch<PdaxTradeResponse>("/pdax-institution/v1/trade", {
      method: "POST",
      body: {
        quote_id: quote.data.quote_id,
        side: "sell",
        idempotency_id: args.identifier,
      },
    });
  } catch (e) {
    if (!isPdaxDuplicateRequest(e)) throw e;
  }

  // Same idempotency contract for /fiat/withdraw — also rejects repeats.
  // A retry past /fiat/withdraw means the payout request is queued, so
  // proceed as if it succeeded.
  try {
    await pdaxFetch("/pdax-institution/v1/fiat/withdraw", {
      method: "POST",
      body: buildFiatWithdrawBody({
        identifier: args.identifier,
        amountPhp: phpInt,
        bankCode: args.bankCode,
        accountName: args.accountName,
        accountNumber: args.accountNumber,
      }),
    });
  } catch (e) {
    if (!isPdaxDuplicateRequest(e)) throw e;
  }

  return { totalPhp: phpInt };
}

/** Heavy /fiat/withdraw body. Sender = "Sobre Wallet" because that's the
 *  institution's perspective. PDAX requires BOTH middle-name fields even
 *  when first/last are present — leaving them off returns 400
 *  "{field} is required". */
export function buildFiatWithdrawBody(args: {
  identifier: string;
  amountPhp: number;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}) {
  const parts = args.accountName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? args.accountName;
  const last = parts.length > 1 ? parts[parts.length - 1] : args.accountName;
  const middle =
    parts.length > 2 ? parts.slice(1, -1).join(" ") : MIDDLE_NAME_FALLBACK;
  return {
    identifier: args.identifier,
    amount: String(args.amountPhp),
    currency: "PHP",
    method: "PAY-TO-ACCOUNT-REAL-TIME",
    fee_type: "Beneficiary",
    beneficiary_bank_code: args.bankCode,
    beneficiary_account_name: args.accountName,
    beneficiary_account_number: args.accountNumber,
    beneficiary_first_name: first,
    beneficiary_middle_name: middle,
    beneficiary_last_name: last,
    sender_first_name: "Sobre",
    sender_middle_name: MIDDLE_NAME_FALLBACK,
    sender_last_name: "Wallet",
    ...TRAVEL_RULE_DEFAULTS,
  };
}

/**
 * One-shot check whether the relay's classic payment is included on
 * Horizon. Called from the poll-status route which already polls at 3s,
 * so we don't loop here — a tick that finds NOT_FOUND just bails and the
 * next tick retries. Returns true on confirmed inclusion, false otherwise.
 */
export async function isRelayPaymentIncluded(args: {
  submittedHash: string;
}): Promise<boolean> {
  const resp = await fetch(
    `${NETWORK.horizonUrl}/transactions/${args.submittedHash}`,
  );
  if (!resp.ok) return false;
  const body = (await resp.json()) as { successful?: boolean };
  return body.successful === true;
}

