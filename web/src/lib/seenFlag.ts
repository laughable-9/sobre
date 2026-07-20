/**
 * Factory for a per-browser boolean flag persisted in localStorage.
 * Handy for "have they seen this?" tour/onboarding states where the
 * only bit of state is a single key that flips once.
 *
 * SSR-safe (all methods no-op on the server); private-mode-safe (any
 * storage exception is swallowed, so the flag just behaves as unset).
 */
export function makeSeenFlag(key: string) {
  return {
    has(): boolean {
      if (typeof window === "undefined") return false;
      try {
        return window.localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    mark(): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        /* private-mode etc.; ok to ignore, flag just stays unset */
      }
    },
    reset(): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* private-mode etc. */
      }
    },
    /** The raw storage key. Exposed so callers can listen for cross-tab
     *  updates via the `storage` event. */
    key,
  };
}
