/**
 * Per-browser flag set when the admin clicks "Close wallet". Allows the UI
 * to surface "this Sobre is closed" on subsequent visits without an
 * on-chain `closed` flag. The contract still allows operations technically,
 * but the dashboard hides the closed wallet and shows a closed-state screen
 * when navigating into one — good enough for the demo.
 *
 * For production v2 the contract gains a real closed bool that blocks
 * deposit/spend/join after close.
 */

const KEY = "sobre.closed";

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSet(): Set<string> {
  const storage = safeLocalStorage();
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSet(s: Set<string>): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(Array.from(s)));
  } catch {
    // quota refused; ignore
  }
}

export function isSobreClosed(contractId: string): boolean {
  return readSet().has(contractId);
}

export function markSobreClosed(contractId: string): void {
  const set = readSet();
  set.add(contractId);
  writeSet(set);
}
