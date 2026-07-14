/**
 * Per-browser, per-address default profile. When a user first connects a
 * wallet we ask them once and reuse the display name as the pre-filled
 * default for every Sobre they open or join later. Identity images come
 * from Google OAuth (see WalletMenu / Avatar), not stored here.
 */

export interface UserProfile {
  name: string;
}

function key(address: string): string {
  return `sobre.profile.${address}`;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getProfile(address: string): UserProfile | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name !== "string") return null;
    return { name: parsed.name };
  } catch {
    return null;
  }
}

/** Returns `true` when the write actually landed, `false` if
 *  localStorage was disabled (Safari private, quota exhausted). Callers
 *  should surface a "couldn't save" affordance on `false` instead of
 *  quietly moving on — the user would otherwise be re-prompted on their
 *  next refresh with no explanation. */
export function setProfile(address: string, profile: UserProfile): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(key(address), JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
