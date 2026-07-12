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

export function setProfile(address: string, profile: UserProfile): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key(address), JSON.stringify(profile));
  } catch {
    // quota or refused; skip
  }
}
