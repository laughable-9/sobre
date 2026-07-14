"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Sums today's cashout PHP for one member across `pdax_withdrawals`.
 *  Backs the household-policy daily-limit gate in the cashout modal.
 *
 *  What counts as "today's usage":
 *    - status is anywhere in the pipeline past `pending` (any row that
 *      actually moved money on chain: spent, transferred, converted,
 *      processing, paid). Pure `pending` rows aren't billed yet; a user
 *      who created and abandoned one shouldn't have their budget eaten.
 *    - `created_at >= start-of-day` in Asia/Manila (household policy is
 *      a wall-clock notion, not UTC).
 *
 *  RLS gates the query to family members of `familyWalletId`. A
 *  non-member wouldn't reach the modal in the first place; this is a
 *  cheap extra guard.
 */
export function useDailyCashoutTotal(
  familyWalletId: string | null,
  memberWalletDbId: string | null,
): {
  totalPhp: number;
  loading: boolean;
  refresh: () => void;
} {
  const [totalPhp, setTotalPhp] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!familyWalletId || !memberWalletDbId) {
      setTotalPhp(0);
      return;
    }
    setLoading(true);
    const start = startOfManilaDayIso();
    const supabase = getSupabaseBrowserClient();
    void supabase
      .from("pdax_withdrawals")
      .select("amount_php")
      .eq("family_wallet_id", familyWalletId)
      .eq("member_id", memberWalletDbId)
      .gte("created_at", start)
      .in("status", [
        "spent",
        "transferred",
        "converted",
        "processing",
        "paid",
      ])
      .then(({ data }) => {
        const sum = (data ?? []).reduce(
          (acc, r) => acc + Number((r as { amount_php: number }).amount_php ?? 0),
          0,
        );
        setTotalPhp(sum);
      })
      .then(() => setLoading(false));
  }, [familyWalletId, memberWalletDbId]);

  useEffect(() => {
    // Fetch-on-mount external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return { totalPhp, loading, refresh };
}

/** Start of today in Asia/Manila, as an ISO string. Household policy is
 *  a wall-clock rule so we bucket by PH-local calendar day; UTC day
 *  boundaries would let a 10pm cashout share a bucket with the next
 *  morning's. */
function startOfManilaDayIso(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  // PH is UTC+8, no DST; hardcoding the offset avoids pulling in a
  // timezone library. Start-of-day 00:00 PH local = 16:00 UTC previous
  // day, which is what `T00:00:00+08:00` encodes.
  return `${y}-${m}-${d}T00:00:00+08:00`;
}
