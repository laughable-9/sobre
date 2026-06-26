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
import {
  isCryptoWebhook,
  isFiatWebhook,
  kickOffPdaxWithdraw,
  type PdaxCryptoWebhook,
  type PdaxFiatWebhook,
  type PdaxWebhookPayload,
} from "@/lib/pdax/deposits";
import { convertAndPayoutPhp } from "@/lib/pdax/withdrawals";
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
    // PDAX's fiat WITHDRAWAL webhook is the authoritative settlement
    // signal. COMPLETED here means InstaPay actually landed money in
    // the user's bank (matches their "Has Been Processed" email). We
    // skip the `processing` grace period entirely and go straight to
    // `paid`. IN-PROGRESS keeps us at `processing` so the modal /
    // activity feed don't flip backwards on transient signals.
    const status =
      p.status === "COMPLETED"
        ? "paid"
        : p.status === "FAILED"
          ? "failed"
          : "processing";
    // PDAX's webhook may carry a rejection code we don't have a strict
    // type for (e.g. "rejection_reason" or "fail_reason"). Persist
    // whatever they send so the modal can show the user something
    // actionable instead of the generic "Something went wrong".
    const raw = p as unknown as Record<string, unknown>;
    const failureReason =
      status === "failed"
        ? (raw.rejection_reason as string | undefined) ??
          (raw.fail_reason as string | undefined) ??
          "PDAX rejected the bank settlement"
        : null;
    const update: Record<string, unknown> = { status, amount_php: p.amount };
    if (failureReason) update.failure_reason = failureReason;
    await admin
      .from("pdax_withdrawals")
      .update(update)
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
    // User → PDAX (institution credit): the relay's classic payment to PDAX
    // has been credited. PDAX doesn't echo our internal identifier on
    // inbound deposits, so we match by transaction_hash against the
    // `transfer_tx_hash` the poll-status route stamped when it submitted
    // the relay payment.
    //
    // The atomic claim on (status='spent' → 'transferred') guards against
    // both this webhook AND the poll-status route firing concurrently.
    // Whichever wins, runs convertAndPayoutPhp once.
    const { data: claimed } = await admin
      .from("pdax_withdrawals")
      .update({ status: "transferred" })
      .eq("transfer_tx_hash", p.transaction_hash)
      .eq("status", "spent")
      .select(
        "identifier, amount_php, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number",
      );
    if (!claimed?.length) return;
    const row = claimed[0] as {
      identifier: string;
      amount_php: number;
      beneficiary_bank_code: string;
      beneficiary_account_name: string;
      beneficiary_account_number: string;
    };

    // Move straight to converted+pay — same idempotent helper the
    // poll-status route uses. Webhook + poll converge on the same path.
    await admin
      .from("pdax_withdrawals")
      .update({ status: "converted" })
      .eq("identifier", row.identifier);

    const { totalPhp } = await convertAndPayoutPhp({
      identifier: row.identifier,
      amountPhp: row.amount_php,
      bankCode: row.beneficiary_bank_code,
      accountName: row.beneficiary_account_name,
      accountNumber: row.beneficiary_account_number,
    });
    await admin
      .from("pdax_withdrawals")
      .update({ amount_php: totalPhp, token_currency: PAYMENT_TOKEN })
      .eq("identifier", row.identifier);
    return;
  }
}
