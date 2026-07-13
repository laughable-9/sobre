/**
 * POST /api/pdax/fiat/deposit
 *
 * Initiate a "Add money via PDAX" request:
 *   1. Auth the caller via Supabase session.
 *   2. Confirm they're a member of the target family wallet.
 *   3. Generate a UUIDv4 identifier — used as PDAX's `identifier` (idempotency
 *      key on PDAX's side) and as our row PK on `pdax_deposits`.
 *   4. Insert the row with status='pending'.
 *   5. Call PDAX `POST /fiat/deposit` (method: instapay_upay_cashin).
 *   6. Update the row with PDAX's payment_checkout_url.
 *   7. Return { identifier, paymentCheckoutUrl } to the frontend.
 *
 * The user opens the checkout URL, completes payment via InstaPay QR, and
 * PDAX fires the fiat webhook to /api/pdax/webhook when the payment lands.
 * That handler orchestrates the PHP→USDC trade + crypto withdraw to the
 * user's smart wallet.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { pdaxEnv } from "@/lib/env";
import { pdaxErrorToResponse, pdaxFetch, PdaxError } from "@/lib/pdax/client";
import {
  buildFiatDepositBody,
  type PdaxFiatDepositResponse,
} from "@/lib/pdax/deposits";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface RequestBody {
  amount_php: number;
  /** Family Sobre contract C-address. The route resolves the matching
   *  `family_wallets.id` internally so the frontend doesn't have to track
   *  the Supabase row id. */
  contract_id: string;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Sobre", last: "User" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (
    !body ||
    typeof body.amount_php !== "number" ||
    body.amount_php <= 0 ||
    typeof body.contract_id !== "string"
  ) {
    return NextResponse.json(
      { error: "Invalid body: expect { amount_php > 0, contract_id }" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: familyRow } = await admin
    .from("family_wallets")
    .select("id")
    .eq("contract_id", body.contract_id)
    .single();
  if (!familyRow) {
    return NextResponse.json(
      { error: "Family wallet not found for this contract" },
      { status: 404 },
    );
  }
  const familyWalletId = (familyRow as { id: string }).id;

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;
  const { memberId, fullName } = ctx;

  const rate = await enforceDailyLimit({
    endpoint: "pdax_fiat_deposit",
    walletId: memberId,
    familyWalletId,
    callerEmail: ctx.email,
    perUser: 20,
    perFamily: 50,
  });
  if (rate) return rate;

  const identifier = crypto.randomUUID();
  const { error: insertErr } = await admin.from("pdax_deposits").insert({
    identifier,
    family_wallet_id: familyWalletId,
    member_id: memberId,
    amount_php: body.amount_php,
    status: "pending",
  });
  if (insertErr) {
    return NextResponse.json(
      { error: `pdax_deposits insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  // ─── Mock-mode short-circuit ──────────────────────────────────────────
  if (pdaxEnv().mock) {
    const fakeUrl = `https://mock-pdax.test/checkout/${identifier}`;
    await admin
      .from("pdax_deposits")
      .update({ payment_checkout_url: fakeUrl })
      .eq("identifier", identifier);
    return NextResponse.json({
      identifier,
      paymentCheckoutUrl: fakeUrl,
      mock: true,
    });
  }

  // ─── Call PDAX ────────────────────────────────────────────────────────
  const { first, last } = splitName(fullName);
  try {
    const pdaxResp = await pdaxFetch<PdaxFiatDepositResponse>(
      "/pdax-institution/v1/fiat/deposit",
      {
        method: "POST",
        body: buildFiatDepositBody({
          amountPhp: body.amount_php,
          identifier,
          senderFirstName: first,
          senderLastName: last,
        }),
      },
    );

    await admin
      .from("pdax_deposits")
      .update({ payment_checkout_url: pdaxResp.payment_checkout_url })
      .eq("identifier", identifier);

    return NextResponse.json({
      identifier,
      paymentCheckoutUrl: pdaxResp.payment_checkout_url,
    });
  } catch (e) {
    await admin
      .from("pdax_deposits")
      .update({
        status: "failed",
        failure_reason: e instanceof Error ? e.message : String(e),
      })
      .eq("identifier", identifier);
    if (e instanceof PdaxError) {
      console.error("[pdax fiat/deposit]", e.status, JSON.stringify(e.body));
    }
    return pdaxErrorToResponse(e, "PDAX rejected the deposit request");
  }
}
