"use client";

/**
 * Persists a half-completed envelope-to-envelope transfer so a retry after
 * a wifi blip or leg-2 failure runs ONLY the missing leg (`deposit_with_split`)
 * instead of re-running the withdraw and double-debiting the source envelope.
 *
 * Same in-memory + localStorage two-tier as {@link cashoutRecovery}: memory
 * survives a modal unmount inside the same tab even when Safari-private
 * disables `localStorage`.
 */

export interface TransferRecoverySnapshot {
  contractId: string;
  userAddress: string;
  sourceEnvelope: "Groceries" | "Tuition" | "Savings";
  destinationEnvelope: "Groceries" | "Tuition" | "Savings";
  /** Stroops as string — JSON can't carry bigint. */
  amountStroops: string;
  /** Successful withdraw tx hash from leg 1. Presence of this + a matching
   *  args tuple is the whole "leg-1 already ran, skip it" signal. */
  withdrawTxHash: string;
  savedAt: number;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEY = "sobre.transfer-recovery.v1";

let memorySnapshot: TransferRecoverySnapshot | null = null;

export function saveTransferRecovery(
  snapshot: Omit<TransferRecoverySnapshot, "savedAt">,
): void {
  const full: TransferRecoverySnapshot = { ...snapshot, savedAt: Date.now() };
  memorySnapshot = full;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    // best effort — the memory mirror keeps the retry-idempotence path
    // alive for this tab.
  }
}

export function readTransferRecovery(): TransferRecoverySnapshot | null {
  if (memorySnapshot) {
    if (Date.now() - memorySnapshot.savedAt > MAX_AGE_MS) {
      memorySnapshot = null;
    } else {
      return memorySnapshot;
    }
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TransferRecoverySnapshot;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearTransferRecovery(): void {
  memorySnapshot = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // best effort
  }
}

/** True when a saved snapshot matches the args the caller wants to run —
 *  i.e. the withdraw the user is about to sign already succeeded once. */
export function transferSnapshotMatches(
  snapshot: TransferRecoverySnapshot,
  args: {
    contractId: string;
    userAddress: string;
    sourceEnvelope: string;
    destinationEnvelope: string;
    amountStroops: bigint;
  },
): boolean {
  return (
    snapshot.contractId === args.contractId &&
    snapshot.userAddress === args.userAddress &&
    snapshot.sourceEnvelope === args.sourceEnvelope &&
    snapshot.destinationEnvelope === args.destinationEnvelope &&
    snapshot.amountStroops === args.amountStroops.toString()
  );
}
