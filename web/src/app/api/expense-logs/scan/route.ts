/**
 * POST /api/expense-logs/scan
 *
 * Receipt OCR + envelope classification via Gemini. Multipart body:
 *   - `family_wallet_id`: the family the receipt belongs to.
 *   - `image`: JPEG bytes (client compresses to ~150–250 KB before upload).
 *
 * Returns the parsed ReceiptScan. Does NOT persist: the client reviews the
 * scan, edits fields, then hits POST /api/expense-logs with the confirmed
 * payload + image bytes to save the row and upload the receipt.
 *
 * Auth: caller must be a member of the family wallet (requireFamilyMember).
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { classifyReceipt, type ReceiptScan } from "@/lib/gemini";
import { ENVELOPE_LABELS } from "@/lib/config";
import { isUuid } from "@/lib/format";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 500 * 1024; // 500 KB defensive ceiling.
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body." },
      { status: 400 },
    );
  }

  const familyWalletId = form.get("family_wallet_id");
  const image = form.get("image");
  const priorScanRaw = form.get("prior_scan");
  let priorScan: ReceiptScan | null = null;
  if (typeof priorScanRaw === "string" && priorScanRaw.length > 0) {
    try {
      priorScan = JSON.parse(priorScanRaw) as ReceiptScan;
    } catch {
      return NextResponse.json(
        { error: "prior_scan must be valid JSON." },
        { status: 400 },
      );
    }
  }
  if (!isUuid(familyWalletId)) {
    return NextResponse.json(
      { error: "family_wallet_id (uuid) is required." },
      { status: 400 },
    );
  }
  if (!(image instanceof Blob)) {
    return NextResponse.json(
      { error: "image (Blob) is required." },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image too large. Max ${MAX_IMAGE_BYTES} bytes.` },
      { status: 413 },
    );
  }
  const mimeType = image.type || "image/jpeg";
  if (!ACCEPTED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${mimeType}` },
      { status: 415 },
    );
  }

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;

  // Daily cap: Gemini free tier gives 1,500 scans/day per project. Cap each
  // user at 30 and each family at 60 so one abusive session can't burn the
  // shared quota for everyone.
  const rate = await enforceDailyLimit({
    endpoint: "expense_log_scan",
    walletId: ctx.memberId,
    familyWalletId,
    callerEmail: ctx.email,
    perUser: 30,
    perFamily: 60,
  });
  if (rate) return rate;

  // Ground-truth envelope labels for the classifier. Falls back to canonical
  // names if the row is missing (bootstrap-fresh family).
  const admin = getSupabaseAdmin();
  const { data: nameRows } = await admin
    .from("family_envelope_names")
    .select("envelope_key, display_name")
    .eq("family_wallet_id", familyWalletId);
  const envelopeNames = ENVELOPE_LABELS.map((k) => {
    const row = (nameRows ?? []).find(
      (r) => (r as { envelope_key: string }).envelope_key === k,
    ) as { display_name: string } | undefined;
    return row?.display_name ?? k;
  }) as [string, string, string];

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await image.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read image bytes." }, { status: 400 });
  }

  try {
    const scan = await classifyReceipt(bytes, mimeType, envelopeNames, priorScan);
    return NextResponse.json({ scan, envelope_names: envelopeNames });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Gemini free tier: 429 → surfaced as a normal error, client shows retry.
    const status = /429|quota|rate/i.test(message) ? 429 : 502;
    return NextResponse.json(
      { error: `Receipt scan failed: ${message}` },
      { status },
    );
  }
}
