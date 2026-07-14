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
import { acquireDepositClaim, releaseDepositClaim } from "@/lib/pdax/depositClaim";
import {
  isCryptoWebhook,
  isFiatWebhook,
  kickOffPdaxWithdraw,
  type PdaxCryptoWebhook,
  type PdaxFiatWebhook,
  type PdaxWebhookPayload,
} from "@/lib/pdax/deposits";
import {
  convertAndPayoutPhp,
  isPdaxDuplicateRequest,
} from "@/lib/pdax/withdrawals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const env = pdaxEnv();
  const url = new URL(req.url);
  // If PDAX_WEBHOOK_SECRET isn't set, refuse ALL webhook calls — the
  // old `env.webhookSecret && ...` guard short-circuited to "accept"
  // when the env was missing, which would let any anonymous POST drive
  // the state machine (flip deposits to funded → triggers PDAX trade,
  // mark withdrawals to paid, etc). Reject with 503 so a misconfigured
  // deploy is loud rather than silently exploitable.
  if (!env.webhookSecret) {
    console.error(
      "[pdax webhook] PDAX_WEBHOOK_SECRET not configured; rejecting webhook",
    );
    return NextResponse.json(
      { error: "Webhook handler not configured" },
      { status: 503 },
    );
  }
  if (url.searchParams.get("key") !== env.webhookSecret) {
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
      // Guard against a late IN-PROGRESS / FAILED webhook downgrading a
      // row that the polling path already advanced to funded/credited/
      // split. Only mutate `pending` rows here — anything past pending
      // owns its own terminal state.
      await admin
        .from("pdax_deposits")
        .update({ status: p.status === "FAILED" ? "failed" : "pending" })
        .eq("identifier", p.identifier)
        .eq("status", "pending");
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
    //
    // Atomic claim gates the external PDAX call so the webhook and
    // poll-status can't both fire /trade + /crypto/withdraw against the
    // same row. isPdaxDuplicateRequest swallowed here so a claim we win
    // AFTER poll-status has already run its own doesn't 500 the webhook
    // (which would trigger PDAX's retry loop).
    const { data: row } = await admin
      .from("pdax_deposits")
      .select("amount_php")
      .eq("identifier", p.identifier)
      .single();
    if (!row) return;

    const claim = await acquireDepositClaim(admin, p.identifier, "pending");
    if (!claim) return;
    try {
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
          withdraw_tx_hash: null,
        })
        .eq("identifier", p.identifier)
        .eq("status", "pending")
        .eq("withdraw_tx_hash", claim);
    } catch (e) {
      if (isPdaxDuplicateRequest(e)) {
        await releaseDepositClaim(admin, p.identifier, claim);
        return;
      }
      await releaseDepositClaim(admin, p.identifier, claim);
      throw e;
    }
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
    // Guard against a stale/late FAILED webhook overwriting a row that
    // the 10s processing-grace already promoted to `paid`. Webhooks can
    // arrive out of order or after the user has seen the success state,
    // and flipping `paid` → `failed` mid-demo would be the worst kind of
    // visible bug. The poll-status grace itself also re-checks PDAX
    // before promoting, so a `paid` row reflects a confirmed signal.
    await admin
      .from("pdax_withdrawals")
      .update(update)
      .eq("identifier", p.identifier)
      .not("status", "eq", "paid");
    return;
  }
}

async function handleCrypto(p: PdaxCryptoWebhook): Promise<void> {
  const admin = getSupabaseAdmin();

  if (p.transaction_type === "WITHDRAWAL") {
    // Sobre→relay: PDAX sent the payment token to the relay G-address.
    //
    // We do NOT advance funded → credited from the webhook. The polling
    // path (advanceFromFunded → tryCompleteWithdrawAndTransfer →
    // depositFromXlmToSobre) is the sole authority for that transition
    // because it's the one that actually runs deposit_from_xlm on chain.
    // If we flipped status to credited here, a webhook winning the race
    // with the poll would leave the row reading "credited" while envelopes
    // are unfunded. The polling path uses Horizon as the completion
    // signal, so it doesn't need this webhook to notify it — /active
    // surfaces funded rows to the dashboard and the poll drives them
    // forward.
    //
    // We DO handle the failure signal here (the poll can't distinguish
    // "PDAX marked failed" from "Horizon hasn't caught up yet"), and we
    // preserve the tx hash + amount for later reconciliation.
    if (p.status === "failed") {
      // Accept the failure signal from any non-terminal row. If the FAILED
      // event races ahead of the COMPLETED (or of the poll advancing
      // pending → funded), gating strictly on status='funded' silently
      // drops the failure and the row later marches to funded on the
      // delayed event as if nothing happened. Terminal statuses (`spent`,
      // `credited`, `failed`) are still excluded via .in() below.
      await admin
        .from("pdax_deposits")
        .update({
          status: "failed",
          failure_reason: "PDAX crypto withdraw failed",
          withdraw_tx_hash: p.transaction_hash,
        })
        .eq("identifier", p.identifier)
        .in("status", ["pending", "funded"]);
      return;
    }
    // Stamp metadata without advancing status. `amount_usdc` and
    // `token_currency` help the polling path's Horizon match if it
    // hadn't cached them yet. Skip `withdraw_tx_hash` because that
    // column doubles as the poll's atomic-claim slot.
    await admin
      .from("pdax_deposits")
      .update({
        amount_usdc: p.amount,
        token_currency: PAYMENT_TOKEN,
      })
      .eq("identifier", p.identifier)
      .eq("status", "funded");
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
    // Gate on status='transferred' so a concurrent poll that already
    // advanced the row to converted/processing/paid doesn't get
    // regressed to converted (visible flicker in the activity feed).
    const { data: advanced } = await admin
      .from("pdax_withdrawals")
      .update({ status: "converted" })
      .eq("identifier", row.identifier)
      .eq("status", "transferred")
      .select("identifier");
    if (!advanced?.length) return;

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
