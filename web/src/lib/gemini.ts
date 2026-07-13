import { GoogleGenAI, Type } from "@google/genai";

import { geminiEnv } from "@/lib/env";
import {
  EXPENSE_CATEGORY_KEYS,
  isExpenseCategory,
  type ExpenseCategoryKey,
} from "@/lib/expenseCategories";

/** One line item on the receipt: description + qty + unit price + a category
 *  tag from the fixed catalogue. Amounts are in Philippine pesos as the
 *  classifier reads them; the API layer converts to stroops for storage. */
export interface ReceiptItem {
  description: string;
  qty: number;
  unit_price_php: number;
  category: ExpenseCategoryKey;
}

/** Structured shape Gemini returns on a successful receipt scan. */
export interface ReceiptScan {
  vendor: string | null;
  amount_php: number | null;
  subtotal_php: number | null;
  tax_php: number | null;
  currency: string | null;
  occurred_at: string | null;
  category: ExpenseCategoryKey | null;
  envelope_index: 0 | 1 | 2 | null;
  envelope_confidence: number;
  note_summary: string;
  items: ReceiptItem[];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    vendor: {
      type: Type.STRING,
      nullable: true,
      description: "Merchant / store / vendor name printed on the receipt.",
    },
    amount_php: {
      type: Type.NUMBER,
      nullable: true,
      description: "Grand total amount paid, in Philippine pesos.",
    },
    subtotal_php: {
      type: Type.NUMBER,
      nullable: true,
      description:
        "Pre-tax subtotal in Philippine pesos. Null when the receipt shows no separate subtotal line.",
    },
    tax_php: {
      type: Type.NUMBER,
      nullable: true,
      description:
        "Tax / VAT line in Philippine pesos. Null when there is no tax line.",
    },
    currency: {
      type: Type.STRING,
      nullable: true,
      description:
        "ISO currency code printed on the receipt (usually 'PHP'). Null when unreadable.",
    },
    occurred_at: {
      type: Type.STRING,
      nullable: true,
      description:
        "ISO-8601 date/time the transaction happened, from the receipt. Null when unreadable.",
    },
    category: {
      type: Type.STRING,
      nullable: true,
      enum: [...EXPENSE_CATEGORY_KEYS],
      description:
        "Best-fit category tag for the whole receipt from the allowed enum.",
    },
    envelope_index: {
      type: Type.INTEGER,
      nullable: true,
      description:
        "Which envelope this expense belongs to. 0=Groceries envelope, 1=Tuition envelope, 2=Savings envelope. Null when uncertain.",
    },
    envelope_confidence: {
      type: Type.NUMBER,
      description: "0..1 confidence in envelope_index and category.",
    },
    note_summary: {
      type: Type.STRING,
      description:
        "Warm one-line narration (<=140 chars) describing the receipt in plain English, e.g. 'A meal at Coconut House featuring pancit, laing, and buco juice.'",
    },
    items: {
      type: Type.ARRAY,
      description:
        "Every line item on the receipt in reading order. Empty array only when the receipt has no discrete items (e.g. a lump-sum bill).",
      items: {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description: "Item name as printed on the receipt.",
          },
          qty: {
            type: Type.NUMBER,
            description: "Quantity purchased. Default 1 when not printed.",
          },
          unit_price_php: {
            type: Type.NUMBER,
            description: "Peso price per unit. If the receipt only shows a line total, divide by qty.",
          },
          category: {
            type: Type.STRING,
            enum: [...EXPENSE_CATEGORY_KEYS],
            description: "Per-item category tag from the same catalogue.",
          },
        },
        required: ["description", "qty", "unit_price_php", "category"],
      },
    },
  },
  required: ["envelope_confidence", "note_summary", "items"],
} as const;

const SYSTEM_PROMPT = (
  envelopeNames: readonly [string, string, string],
  priorScan: ReceiptScan | null,
) => {
  const priorBlock = priorScan
    ? `

MERGE MODE. An earlier photo of the SAME receipt already produced this scan:
${JSON.stringify(
  {
    vendor: priorScan.vendor,
    amount_php: priorScan.amount_php,
    subtotal_php: priorScan.subtotal_php,
    tax_php: priorScan.tax_php,
    occurred_at: priorScan.occurred_at,
    category: priorScan.category,
    items: priorScan.items,
  },
  null,
  2,
)}

The image attached is another photo of the same receipt (usually a different
section because the receipt is long). Return the FULL merged scan for the
whole receipt, not just the delta:
  - Keep existing items exactly as-is when the new image doesn't disagree.
  - Add any items the new photo shows that aren't already in the list.
  - If both photos show the same item, do NOT list it twice. Increase qty
    only if the receipt itself printed multiple lines for that item.
  - Refine vendor/amount_php/subtotal_php/tax_php/occurred_at when the new
    photo shows a value that was missing (null) before. Prefer values the
    receipt actually prints over any earlier guess.
`
    : "";
  return `
You are Sobre's receipt-reading assistant for a Filipino family wallet.
Extract every line item and the summary totals from the attached receipt image
and return the JSON matching the response schema.

The family divides money across THREE envelopes:
  0 = "${envelopeNames[0]}" (the Groceries envelope: food, drinks, sundry
       household consumables, wet market, "ulam", "baon", grocery runs)
  1 = "${envelopeNames[1]}" (the Tuition envelope: school-related expenses
       like tuition, school supplies, uniforms, books, allowance for kids)
  2 = "${envelopeNames[2]}" (the Savings envelope: money set aside. Only pick
       this for deliberate deposits/transfers to savings, not for spending)

The allowed category tags (both for the whole receipt and each item) are:
  Dining, Groceries, Transportation, School, Kids, Health, Utilities,
  Bills, Load, Housing, Personal, Entertainment, Gifts, Other.

Rules:
- Receipts may be in English, Tagalog, or Taglish. Common labels: "ulam",
  "baon", "grocery", "kuryente" (electricity), "tubig" (water), "tuition",
  "load" (mobile top-up), "bayad" (payment).
- Prefer the printed TOTAL / GRAND TOTAL / AMOUNT DUE for amount_php.
- Populate subtotal_php from the "Subtotal" line and tax_php from any
  "VAT" / "Tax" line. Leave them null when the receipt is a single flat total.
- If the receipt is not in pesos, convert to PHP using a reasonable current
  rate; note the original currency in \`currency\`.
- Vendor rule: use the merchant name exactly as printed. If the receipt has
  no readable merchant name, INVENT a warm 2-4 word descriptor based on
  what was purchased (e.g. "Ramen Night", "Grocery Run", "Coffee Break",
  "School Supplies", "Load Top-up"). Never return null for vendor.
- Set envelope_index only when you're at least 50% sure. Otherwise leave it
  null and set envelope_confidence to your best estimate.
- Fill occurred_at from the receipt's date. If only a date is present, use
  midnight local time (Asia/Manila) in ISO-8601.
- items[] must include every printed line item in reading order. Merge
  identical items with quantity multipliers when the receipt already lists
  them once with a qty column.
- note_summary is a warm, plain-English recap the family will actually read.
  No JSON. No filler. Under 140 characters.
${priorBlock}
`.trim();
};

/** Run Gemini on a receipt image and return the structured scan. When
 *  `priorScan` is provided, the model is told this photo is another slice
 *  of the same receipt and asked to return the merged full scan without
 *  double-counting items. */
export async function classifyReceipt(
  imageBytes: Uint8Array,
  mimeType: string,
  envelopeNames: readonly [string, string, string],
  priorScan: ReceiptScan | null = null,
): Promise<ReceiptScan> {
  const ai = new GoogleGenAI({ apiKey: geminiEnv().apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: Buffer.from(imageBytes).toString("base64"),
            },
          },
          { text: SYSTEM_PROMPT(envelopeNames, priorScan) },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  });

  const text = response.text ?? "";
  const parsed = JSON.parse(text) as Partial<ReceiptScan>;

  const rawIndex =
    typeof parsed.envelope_index === "number" ? parsed.envelope_index : null;
  const clampedIndex =
    rawIndex === 0 || rawIndex === 1 || rawIndex === 2 ? rawIndex : null;
  const confidence =
    typeof parsed.envelope_confidence === "number"
      ? Math.max(0, Math.min(1, parsed.envelope_confidence))
      : 0;
  const category = isExpenseCategory(parsed.category) ? parsed.category : null;

  const items: ReceiptItem[] = Array.isArray(parsed.items)
    ? parsed.items
        .map((raw): ReceiptItem | null => {
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Partial<ReceiptItem>;
          if (typeof r.description !== "string" || r.description.length === 0) {
            return null;
          }
          const qty = typeof r.qty === "number" && r.qty > 0 ? r.qty : 1;
          const unit =
            typeof r.unit_price_php === "number" && r.unit_price_php >= 0
              ? r.unit_price_php
              : 0;
          const itemCategory = isExpenseCategory(r.category)
            ? r.category
            : category ?? "Other";
          return {
            description: r.description.slice(0, 120),
            qty,
            unit_price_php: unit,
            category: itemCategory,
          };
        })
        .filter((v): v is ReceiptItem => v !== null)
    : [];

  return {
    vendor: parsed.vendor ?? null,
    amount_php:
      typeof parsed.amount_php === "number" && parsed.amount_php > 0
        ? parsed.amount_php
        : null,
    subtotal_php:
      typeof parsed.subtotal_php === "number" && parsed.subtotal_php >= 0
        ? parsed.subtotal_php
        : null,
    tax_php:
      typeof parsed.tax_php === "number" && parsed.tax_php >= 0
        ? parsed.tax_php
        : null,
    currency: parsed.currency ?? null,
    occurred_at: parsed.occurred_at ?? null,
    category,
    envelope_index: confidence >= 0.5 ? clampedIndex : null,
    envelope_confidence: confidence,
    note_summary:
      typeof parsed.note_summary === "string" && parsed.note_summary.length > 0
        ? parsed.note_summary.slice(0, 200)
        : "Receipt",
    items,
  };
}
