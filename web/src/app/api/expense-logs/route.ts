/**
 * POST / GET / DELETE /api/expense-logs
 *
 * Off-chain expense records: text-only notes ("What did you spend on?") or
 * structured receipt entries produced by /api/expense-logs/scan (vendor,
 * amount, envelope, category, one or more receipt images). Record-only:
 * moves no funds and is NOT an on-chain spend. Saving is immediate; the
 * client offers a short undo window that calls DELETE to remove the
 * just-created row (and any Storage objects it references).
 *
 * Auth: caller must be a member of the family wallet the entry belongs to
 * (requireFamilyMember). Writes use the service-role client after that check.
 * DELETE additionally restricts to the row's own author.
 */

import { NextResponse } from "next/server";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { isUuid, toStroops } from "@/lib/format";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_NOTE_LEN = 200;
const RECEIPTS_BUCKET = "receipts";
// 1 hour. 10 min still expired mid-session for users idling on the
// dashboard. The bucket is private and signed URLs are per-family-member,
// so a longer TTL doesn't widen the blast radius meaningfully.
const SIGNED_URL_TTL_SEC = 3600;
const MAX_RECEIPT_BYTES = 500 * 1024;
const MAX_RECEIPT_IMAGES = 5;

interface ReceiptImagePayload {
  bytes_base64: string;
  mime?: string | null;
}

interface PostBody {
  family_wallet_id: string;
  note: string;
  amount_stroops?: number | string | null;
  subtotal_stroops?: number | string | null;
  tax_stroops?: number | string | null;
  envelope_index?: 0 | 1 | 2 | null;
  vendor?: string | null;
  category?: string[] | string | null;
  occurred_at?: string | null;
  items?: Array<{
    description: string;
    qty: number;
    unit_price_stroops: number | string;
    category: string;
  }> | null;
  classifier?: unknown;
  /** Multi-photo receipts. Legacy single-image body (receipt_bytes_base64 +
   *  receipt_mime) is still accepted; it collapses into a 1-element array. */
  receipt_images?: ReceiptImagePayload[] | null;
  receipt_bytes_base64?: string | null;
  receipt_mime?: string | null;
}

function normaliseCategoryArray(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    const filtered = v.filter((s): s is string => typeof s === "string" && s.length > 0);
    return filtered.length > 0 ? filtered : null;
  }
  if (typeof v === "string" && v.length > 0) return [v];
  return null;
}

const SELECT_COLS =
  "id, note, created_at, wallet_id, amount_stroops, subtotal_stroops, tax_stroops, envelope_index, vendor, category, receipt_paths, occurred_at, items";

// ── GET: recent notes for a family (dashboard list) ────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const familyWalletId = url.searchParams.get("family_wallet_id");
  const wantSigned = url.searchParams.get("with_signed_urls") === "1";
  if (!isUuid(familyWalletId)) {
    return NextResponse.json(
      { error: "family_wallet_id (uuid) is required" },
      { status: 400 },
    );
  }

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("expense_logs")
    .select(SELECT_COLS)
    .eq("family_wallet_id", familyWalletId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let logs = (data ?? []) as Array<
    Record<string, unknown> & { receipt_paths?: string[] | null }
  >;
  if (wantSigned && logs.length > 0) {
    const allPaths = logs.flatMap((l) =>
      Array.isArray(l.receipt_paths) ? l.receipt_paths : [],
    );
    if (allPaths.length > 0) {
      const { data: signed } = await admin.storage
        .from(RECEIPTS_BUCKET)
        .createSignedUrls(allPaths, SIGNED_URL_TTL_SEC);
      const byPath = new Map<string, string>();
      (signed ?? []).forEach((s) => {
        if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
      });
      logs = logs.map((l) => {
        const paths = Array.isArray(l.receipt_paths) ? l.receipt_paths : [];
        const signedUrls = paths
          .map((p) => byPath.get(p) ?? null)
          .filter((u): u is string => !!u);
        return {
          ...l,
          signed_receipt_urls: signedUrls,
          signed_receipt_url: signedUrls[0] ?? null,
        };
      });
    }
  }
  return NextResponse.json({ logs });
}

// ── POST: log a note or a receipt entry (saves immediately) ────────────────
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body || !isUuid(body.family_wallet_id) || typeof body.note !== "string") {
    return NextResponse.json(
      { error: "Invalid body: expect { family_wallet_id (uuid), note, ... }" },
      { status: 400 },
    );
  }
  const note = body.note.trim();
  if (note.length === 0 || note.length > MAX_NOTE_LEN) {
    return NextResponse.json(
      { error: `note must be 1–${MAX_NOTE_LEN} characters` },
      { status: 400 },
    );
  }
  const amount = toStroops(body.amount_stroops);
  if (amount !== null && amount <= 0n) {
    return NextResponse.json(
      { error: "amount_stroops must be positive when provided" },
      { status: 400 },
    );
  }
  const subtotal = toStroops(body.subtotal_stroops);
  const tax = toStroops(body.tax_stroops);
  const envelope =
    body.envelope_index === 0 || body.envelope_index === 1 || body.envelope_index === 2
      ? body.envelope_index
      : null;
  const items = Array.isArray(body.items)
    ? body.items
        .map((r) => {
          if (!r || typeof r.description !== "string") return null;
          const unit = toStroops(r.unit_price_stroops);
          if (unit === null) return null;
          return {
            description: r.description.slice(0, 120),
            qty: typeof r.qty === "number" && r.qty > 0 ? r.qty : 1,
            unit_price_stroops: unit.toString(),
            category: typeof r.category === "string" ? r.category : "Other",
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
    : null;

  const rawImages: ReceiptImagePayload[] = Array.isArray(body.receipt_images)
    ? body.receipt_images
    : body.receipt_bytes_base64
      ? [{ bytes_base64: body.receipt_bytes_base64, mime: body.receipt_mime }]
      : [];
  if (rawImages.length > MAX_RECEIPT_IMAGES) {
    return NextResponse.json(
      { error: `Too many receipt images. Max ${MAX_RECEIPT_IMAGES}.` },
      { status: 413 },
    );
  }
  const decodedImages: Array<{ bytes: Buffer; mime: string }> = [];
  for (const img of rawImages) {
    if (!img || typeof img.bytes_base64 !== "string") continue;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(img.bytes_base64, "base64");
    } catch {
      return NextResponse.json(
        { error: "receipt_images[].bytes_base64 is not valid base64" },
        { status: 400 },
      );
    }
    if (bytes.length > MAX_RECEIPT_BYTES) {
      return NextResponse.json(
        { error: `Each receipt image must be ≤ ${MAX_RECEIPT_BYTES} bytes.` },
        { status: 413 },
      );
    }
    decodedImages.push({ bytes, mime: img.mime || "image/jpeg" });
  }

  const ctx = await requireFamilyMember(body.family_wallet_id);
  if (ctx instanceof NextResponse) return ctx;

  // Storage-writing saves (multi-photo receipts) hit a tight cap because
  // they fill the 1 GB Supabase free tier fast. Text-only notes get a
  // looser cap since they're just DB rows.
  if (decodedImages.length > 0) {
    const rate = await enforceDailyLimit({
      endpoint: "expense_log_save_image",
      walletId: ctx.memberId,
      familyWalletId: body.family_wallet_id,
      callerEmail: ctx.email,
      perUser: 30,
      perFamily: 60,
    });
    if (rate) return rate;
  } else {
    const rate = await enforceDailyLimit({
      endpoint: "expense_log_save_note",
      walletId: ctx.memberId,
      familyWalletId: body.family_wallet_id,
      callerEmail: ctx.email,
      perUser: 100,
      perFamily: 300,
    });
    if (rate) return rate;
  }

  const admin = getSupabaseAdmin();
  const insertRow: Record<string, unknown> = {
    family_wallet_id: body.family_wallet_id,
    wallet_id: ctx.memberId,
    note,
    amount_stroops: amount !== null ? amount.toString() : null,
    subtotal_stroops: subtotal !== null ? subtotal.toString() : null,
    tax_stroops: tax !== null ? tax.toString() : null,
    items: items && items.length > 0 ? items : null,
    envelope_index: envelope,
    vendor: body.vendor ?? null,
    category: normaliseCategoryArray(body.category),
    occurred_at: body.occurred_at ?? null,
    classifier: body.classifier ?? null,
  };

  const { data: inserted, error: insertErr } = await admin
    .from("expense_logs")
    .insert(insertRow)
    .select(SELECT_COLS)
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }
  let row = inserted as Record<string, unknown> & {
    id: string;
    receipt_paths: string[] | null;
  };

  // Two-step: row committed first (so we always have an id). Each image
  // uploads to <family>/<log>/<index>.jpg. Any single upload failure gets
  // logged but doesn't block the row from returning; images are metadata.
  if (decodedImages.length > 0) {
    // Independent uploads → fire in parallel. Preserves capture order via
    // Promise.all + map-with-index (settled results stay indexed even when
    // some fail).
    const results = await Promise.allSettled(
      decodedImages.map((img, i) => {
        const path = `${body.family_wallet_id}/${row.id}/${i}.jpg`;
        return admin.storage
          .from(RECEIPTS_BUCKET)
          .upload(path, img.bytes, { contentType: img.mime, upsert: true })
          .then((res) => ({ path, error: res.error }));
      }),
    );
    const uploadedPaths: string[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled") {
        console.warn("[expense-logs] receipt upload rejected", r.reason);
        continue;
      }
      if (r.value.error) {
        console.warn(
          "[expense-logs] receipt upload failed",
          r.value.error.message,
        );
        continue;
      }
      uploadedPaths.push(r.value.path);
    }
    if (uploadedPaths.length > 0) {
      const { data: updated } = await admin
        .from("expense_logs")
        .update({ receipt_paths: uploadedPaths })
        .eq("id", row.id)
        .select(SELECT_COLS)
        .single();
      if (updated) row = updated as typeof row;
    }
  }

  return NextResponse.json({ log: row });
}

// ── DELETE: undo, remove a row the caller authored (+ its Storage objects) ─
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const familyWalletId = url.searchParams.get("family_wallet_id");
  if (!isUuid(id) || !isUuid(familyWalletId)) {
    return NextResponse.json(
      { error: "id and family_wallet_id (uuid) are required" },
      { status: 400 },
    );
  }

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;

  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("expense_logs")
    .select("receipt_paths")
    .eq("id", id)
    .eq("family_wallet_id", familyWalletId)
    .eq("wallet_id", ctx.memberId)
    .maybeSingle();

  const { error } = await admin
    .from("expense_logs")
    .delete()
    .eq("id", id)
    .eq("family_wallet_id", familyWalletId)
    .eq("wallet_id", ctx.memberId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const paths = (existing as { receipt_paths?: string[] | null } | null)?.receipt_paths;
  if (paths && paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(RECEIPTS_BUCKET).remove(paths);
    if (rmErr) console.warn("[expense-logs] receipt object delete failed", rmErr.message);
  }
  return NextResponse.json({ ok: true });
}
