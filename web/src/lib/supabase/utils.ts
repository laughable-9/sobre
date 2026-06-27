/**
 * Shared helpers for working with Supabase query results.
 */

/**
 * Supabase's join select on a 1:1 FK returns either a row object OR a
 * single-element array depending on the relationship's cardinality
 * declaration — and the JS client typings reflect that ambiguity. Use
 * this helper at the call site to collapse both shapes to `T | null`.
 *
 *   const { data: row } = await supabase
 *     .from("family_pending_requests")
 *     .select("id, wallets(contract_id)")
 *     .single();
 *   const w = firstJoined<{ contract_id: string }>(row?.wallets);
 *   // w is the single joined wallets row, or null.
 */
export function firstJoined<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
