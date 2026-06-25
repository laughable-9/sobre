/**
 * POST /api/pdax/webhook?key=<PDAX_WEBHOOK_SECRET>
 *
 * PDAX-driven state machine update. Lifecycle paths:
 *
 *   DEPOSIT path (fiat then crypto):
 *     fiat COMPLETED   → row.status = funded → trigger PHP→USDC trade + crypto withdraw
 *     crypto completed → row.status = credited → frontend prompts user to confirm split
 *
 *   WITHDRAWAL path (crypto then fiat):
 *     crypto completed → row.status = transferred (user's USDC reached PDAX)
 *     fiat COMPLETED   → row.status = paid
 *
 * Authenticated by the `?key=` query param matching `PDAX_WEBHOOK_SECRET`.
 * PDAX doesn't sign webhook payloads, so the URL-embedded secret is our
 * only signal that the call originated from PDAX (we registered it with
 * `POST /v1/config/webhook`).
 */

import { NextResponse } from "next/server";

import { PAYMENT_TOKEN } from "@/lib/config";
import { pdaxEnv } from "@/lib/env";
import { pdaxFetch } from "@/lib/pdax/client";
import {
  isCryptoWebhook,
  isFiatWebhook,
  kickOffPdaxWithdraw,
  type PdaxCryptoWebhook,
  type PdaxFiatWebhook,
  type PdaxQuoteResponse,
  type PdaxTradeResponse,
  type PdaxWebhookPayload,
} from "@/lib/pdax/deposits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const env = pdaxEnv();
  const url = new URL(req.url);
  if (env.webhookSecret && url.searchParams.get("key") !== env.webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as PdaxWebhookPayload | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (isFiatWebhook(payload)) {
      await handleFiat(payload);
    } else if (isCryptoWebhook(payload)) {
      await handleCrypto(payload);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[pdax webhook] error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function handleFiat(p: PdaxFiatWebhook): Promise<void> {
  const admin = getSupabaseAdmin();

  if (p.transaction_type === "DEPOSIT") {
    if (p.status !== "COMPLETED") {
      await admin
        .from("pdax_deposits")
        .update({ status: p.status === "FAILED" ? "failed" : "pending" })
        .eq("identifier", p.identifier);
      return;
    }

    // Fiat received → kick off the PHP→token trade + crypto withdraw to
    // the relay. Mark `funded` so the next poll-status call (whether from
    // the modal or a background sweep) drives the funded→credited
    // transition via the SAC transfer.
    //
    // NOTE: webhooks aren't registered in dev (no public URL). The primary
    // path for the hackathon demo is the polling route. This is here so
    // when we DO register the webhook, the architecture stays consistent.
    const { data: row } = await admin
      .from("pdax_deposits")
      .select("amount_php")
      .eq("identifier", p.identifier)
      .single();
    if (!row) return;

    const { netAmount } = await kickOffPdaxWithdraw({
      identifier: p.identifier,
      amountPhp: (row as { amount_php: number }).amount_php,
    });

    await admin
      .from("pdax_deposits")
      .update({
        status: "funded",
        amount_usdc: netAmount,
        token_currency: PAYMENT_TOKEN,
      })
      .eq("identifier", p.identifier)
      .eq("status", "pending");
    return;
  }

  if (p.transaction_type === "WITHDRAWAL") {
    const status = p.status === "COMPLETED" ? "paid" : p.status === "FAILED" ? "failed" : "converted";
    await admin
      .from("pdax_withdrawals")
      .update({ status, amount_php: p.amount })
      .eq("identifier", p.identifier);
    return;
  }
}

async function handleCrypto(p: PdaxCryptoWebhook): Promise<void> {
  const admin = getSupabaseAdmin();

  if (p.transaction_type === "WITHDRAWAL") {
    // Sobre→relay: PDAX sent the payment token to the relay G-address. The
    // crypto webhook isn't registered in dev (no public URL), so the
    // polling path handles this transition today. When this fires for
    // real, mark the row credited — the SAC forward already ran via the
    // polling path that detected the same payment first. `amount_usdc` is
    // a legacy column name; it holds whatever token the family wallet
    // uses, and `token_currency` records which.
    const status = p.status === "completed" ? "credited" : p.status === "failed" ? "failed" : "funded";
    await admin
      .from("pdax_deposits")
      .update({
        status,
        withdraw_tx_hash: p.transaction_hash,
        amount_usdc: p.amount,
        token_currency: PAYMENT_TOKEN,
      })
      .eq("identifier", p.identifier);
    return;
  }

  if (p.transaction_type === "DEPOSIT") {
    // User→Sobre's PDAX account: user's USDC reached us. Move the cashout
    // forward by triggering the USDC→PHP trade + fiat withdraw.
    const { data: row } = await admin
      .from("pdax_withdrawals")
      .select(
        "amount_usdc, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number",
      )
      .eq("identifier", p.identifier)
      .single();
    if (!row) return;

    await admin
      .from("pdax_withdrawals")
      .update({ status: "transferred", transfer_tx_hash: p.transaction_hash })
      .eq("identifier", p.identifier);

    await convertAndPayoutPhp({
      identifier: p.identifier,
      amountUsdc: (row as { amount_usdc: number }).amount_usdc,
      bankCode: (row as { beneficiary_bank_code: string }).beneficiary_bank_code,
      accountName: (row as { beneficiary_account_name: string }).beneficiary_account_name,
      accountNumber: (row as { beneficiary_account_number: string })
        .beneficiary_account_number,
    });
    return;
  }
}

async function convertAndPayoutPhp(args: {
  identifier: string;
  amountUsdc: number;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}): Promise<void> {
  const quote = await pdaxFetch<PdaxQuoteResponse>(
    "/pdax-institution/v1/trade/quote",
    {
      method: "POST",
      body: {
        // Mirror of the buy side — sell the active payment token back to PHP.
        // Same asset switch (PAYMENT_TOKEN) as the deposit pipeline.
        side: "sell",
        quote_currency: PAYMENT_TOKEN,
        base_currency: "PHP",
        base_quantity: String(args.amountUsdc),
      },
    },
  );

  await pdaxFetch<PdaxTradeResponse>("/pdax-institution/v1/trade", {
    method: "POST",
    body: {
      quote_id: quote.data.quote_id,
      side: "sell",
      idempotency_id: args.identifier,
    },
  });

  await pdaxFetch("/pdax-institution/v1/fiat/withdraw", {
    method: "POST",
    body: {
      identifier: args.identifier,
      amount: String(quote.data.total_amount),
      currency: "PHP",
      method: "PAY-TO-ACCOUNT-REAL-TIME",
      fee_type: "Beneficiary",
      beneficiary_bank_code: args.bankCode,
      beneficiary_account_name: args.accountName,
      beneficiary_account_number: args.accountNumber,
      beneficiary_first_name: args.accountName.split(/\s+/)[0] ?? args.accountName,
      beneficiary_last_name:
        args.accountName.split(/\s+/).slice(-1)[0] ?? args.accountName,
      sender_first_name: "Sobre",
      sender_last_name: "Wallet",
      sender_country_origin: "Philippines",
      source_of_funds: "Compensation",
      purpose: "Family Support",
      relationship_of_sender_to_beneficiary: "Myself",
      nature_of_business: "Allowances",
    },
  });
}
