/**
 * Per-browser, per-address default profile (name + emoji). When a user first
 * connects a wallet we ask them once, store it here, and reuse it as the
 * pre-filled defaults for every Sobre they open or join later.
 *
 * Per-Sobre Members on chain can still diverge from this (an admin might
 * pick a different emoji for the family wallet) — this is just the "what
 * should we call you" default, not the source of truth.
 */

import { SOBRE_EMOJIS } from "@/components/sobre/EmojiPicker";

export interface UserProfile {
  name: string;
  emoji: string;
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
    if (
      typeof parsed?.name !== "string" ||
      typeof parsed?.emoji !== "string"
    ) {
      return null;
    }
    return { name: parsed.name, emoji: parsed.emoji };
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

export function defaultEmoji(): string {
  return SOBRE_EMOJIS[0];
}
