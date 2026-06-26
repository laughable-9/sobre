"use client";

/**
 * Persists a half-completed cashout to localStorage so the user can resume
 * after a wifi blip, browser close, or — most importantly — a SAC transfer
 * tx that failed on chain after the spend already debited the envelope.
 *
 * Lifecycle:
 *   - useCashoutSignatures.signAndForward() saves the snapshot the moment
 *     the spend tx returns SUCCESS, BEFORE attempting the SAC transfer.
 *   - usePdaxWithdraw.confirmSigned() clears the snapshot on success.
 *   - PdaxWithdrawModal checks for a snapshot on mount and offers a Resume
 *     step if found.
 *
 * The snapshot stores everything needed to re-run only the SAC transfer
 * + /confirmed steps. The spend tx isn't redone — it already happened
 * and we have its hash.
 */

export interface CashoutRecoverySnapshot {
  identifier: string;
  contractId: string;
  spendTxHash: string;
  /** Stroops as a string — JSON can't carry bigint. Caller re-parses. */
  amountStroops: string;
  relayG: string;
  envelope: "Groceries" | "Tuition" | "Savings";
  amountPhp: number;
  amountToken: number;
  bankCode: string;
  accountName: string;
  accountNumber: string;
  /** When the snapshot was written. Used for "started X minutes ago" copy
   *  and a hard expiry so we don't surface week-old snapshots. */
  savedAt: number;
}

/** Bound the recovery prompt to 24 hours. A snapshot older than that is
 *  almost certainly noise the user has forgotten about, and the relay's
 *  XLM may have been swept by a manual operations step. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEY = "sobre.cashout-recovery.v1";

export function saveCashoutRecovery(
  snapshot: Omit<CashoutRecoverySnapshot, "savedAt">,
): void {
  try {
    const full: CashoutRecoverySnapshot = { ...snapshot, savedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    // localStorage may be disabled (Safari private, quota); recovery falls
    // back to the server-side detection path.
  }
}

export function readCashoutRecovery(): CashoutRecoverySnapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CashoutRecoverySnapshot;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCashoutRecovery(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // best effort
  }
}
