/**
 * Per-browser, per-address registry of Sobres the user has joined as a non-
 * admin member. Lets the "My Sobres" landing list wallets the user belongs
 * to without an on-chain index (the factory only tracks admins; member-side
 * indexing would need a second contract callback we'd rather avoid for v1).
 *
 * Storage shape: localStorage["sobre.joined.<address>"] = JSON string array
 * of contract IDs. We dedupe and cap to a sensible size.
 */

const MAX_REMEMBERED = 50;

function key(address: string): string {
  return `sobre.joined.${address}`;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getJoinedSobres(address: string): string[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(key(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function rememberJoinedSobre(address: string, contractId: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  const existing = getJoinedSobres(address);
  if (existing.includes(contractId)) return;
  const next = [contractId, ...existing].slice(0, MAX_REMEMBERED);
  try {
    storage.setItem(key(address), JSON.stringify(next));
  } catch {
    // quota or refused; skip silently
  }
}

export function forgetJoinedSobre(
  address: string,
  contractId: string,
): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  const existing = getJoinedSobres(address);
  const next = existing.filter((id) => id !== contractId);
  try {
    storage.setItem(key(address), JSON.stringify(next));
  } catch {
    // ignore
  }
}
