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

import { pdaxEnv } from "@/lib/env";
import { pdaxFetch } from "@/lib/pdax/client";
import {
  isCryptoWebhook,
  isFiatWebhook,
  type PdaxCryptoWebhook,
  type PdaxFiatWebhook,
  type PdaxQuoteResponse,
  type PdaxTradeResponse,
  type PdaxCryptoWithdrawResponse,
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

    // Fiat received → trigger the PHP→USDC conversion + crypto withdraw.
    const { data: row } = await admin
      .from("pdax_deposits")
      .select("family_wallet_id, member_id, amount_php")
      .eq("identifier", p.identifier)
      .single();
    if (!row) return;

    await admin
      .from("pdax_deposits")
      .update({ status: "funded" })
      .eq("identifier", p.identifier);

    // The member's smart wallet C-address is the destination for the USDC.
    const { data: wallet } = await admin
      .from("wallets")
      .select("contract_id")
      .eq("id", (row as { member_id: string }).member_id)
      .single();
    if (!wallet) return;

    await convertAndWithdrawUsdc({
      identifier: p.identifier,
      amountPhp: (row as { amount_php: number }).amount_php,
      destinationCAddress: (wallet as { contract_id: string }).contract_id,
    });
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
    // Sobre→user: PDAX sent USDC out to the user's smart wallet. Update the
    // deposit row so the dashboard can prompt the user to confirm split.
    const status = p.status === "completed" ? "credited" : p.status === "failed" ? "failed" : "funded";
    await admin
      .from("pdax_deposits")
      .update({
        status,
        withdraw_tx_hash: p.transaction_hash,
        amount_usdc: p.amount,
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

async function convertAndWithdrawUsdc(args: {
  identifier: string;
  amountPhp: number;
  destinationCAddress: string;
}): Promise<void> {
  // PDAX quote: sell PHP for USDCXLM.
  const quote = await pdaxFetch<PdaxQuoteResponse>(
    "/pdax-institution/v1/trade/quote",
    {
      method: "POST",
      body: {
        side: "buy",
        quote_currency: "USDCXLM",
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

  // The actual USDC amount we got from the trade. PDAX returns this on the
  // trade response — we use it for the crypto withdrawal so the user receives
  // exactly what their PHP bought, minus the trade fee.
  const usdcAmount = trade.data.base_quantity;

  await pdaxFetch<PdaxCryptoWithdrawResponse>(
    "/pdax-institution/v1/crypto/withdraw",
    {
      method: "POST",
      body: {
        identifier: args.identifier,
        currency: "USDCXLM",
        amount: String(usdcAmount),
        address: args.destinationCAddress,
        // Self-custody C-address — Travel Rule flags don't apply at this
        // size, but for consistency we tag the wallet as non-custodial.
        beneficiary_wallet: "true",
        send_to_self: "true",
      },
    },
  );
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
        side: "sell",
        quote_currency: "USDCXLM",
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
