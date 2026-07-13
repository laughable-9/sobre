/**
 * Fixed catalogue of expense category tags. Shared by the Gemini prompt
 * (as the allowed set the classifier picks from) and the review sheet
 * (as chips the user can flip). Any new tag has to land here first so the
 * classifier stops guessing free-form strings that don't map cleanly.
 *
 * `envelopeIndex`: which of the family's three on-chain envelopes this tag
 * naturally attributes to. Used to derive envelope_index server-side when
 * the classifier picks a category. Null means "no natural envelope home"
 * so the row gets envelope_index=null and shows up only in per-category
 * roll-ups, not per-envelope ones.
 */

export type ExpenseCategoryKey =
  | "Dining"
  | "Groceries"
  | "Transportation"
  | "School"
  | "Kids"
  | "Health"
  | "Utilities"
  | "Bills"
  | "Load"
  | "Housing"
  | "Personal"
  | "Entertainment"
  | "Gifts"
  | "Other";

export interface ExpenseCategory {
  key: ExpenseCategoryKey;
  label: string;
  /** 0=Groceries, 1=Tuition, 2=Savings, or null when no natural home. */
  envelopeIndex: 0 | 1 | 2 | null;
}

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  { key: "Dining", label: "Dining", envelopeIndex: 0 },
  { key: "Groceries", label: "Groceries", envelopeIndex: 0 },
  { key: "Transportation", label: "Transportation", envelopeIndex: 0 },
  { key: "School", label: "School", envelopeIndex: 1 },
  { key: "Kids", label: "Kids", envelopeIndex: 1 },
  { key: "Health", label: "Health", envelopeIndex: 0 },
  { key: "Utilities", label: "Utilities", envelopeIndex: 0 },
  { key: "Bills", label: "Bills", envelopeIndex: 0 },
  { key: "Load", label: "Load", envelopeIndex: 0 },
  { key: "Housing", label: "Housing", envelopeIndex: 0 },
  { key: "Personal", label: "Personal", envelopeIndex: 0 },
  { key: "Entertainment", label: "Entertainment", envelopeIndex: 0 },
  { key: "Gifts", label: "Gifts", envelopeIndex: 0 },
  { key: "Other", label: "Other", envelopeIndex: null },
];

export const EXPENSE_CATEGORY_KEYS: readonly ExpenseCategoryKey[] =
  EXPENSE_CATEGORIES.map((c) => c.key);

export function envelopeForCategory(
  category: string | null | undefined,
): 0 | 1 | 2 | null {
  if (!category) return null;
  const hit = EXPENSE_CATEGORIES.find((c) => c.key === category);
  return hit?.envelopeIndex ?? null;
}

export function isExpenseCategory(v: unknown): v is ExpenseCategoryKey {
  return typeof v === "string" && EXPENSE_CATEGORY_KEYS.includes(v as ExpenseCategoryKey);
}
