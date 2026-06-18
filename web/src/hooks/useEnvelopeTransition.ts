"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Drives the envelope page-transition overlay (see
 * `components/sobre/EnvelopeTransition.tsx`). A CTA calls `playFlyout(href)` to
 * run the fly-away cover animation and then navigate.
 *
 * The hook and the overlay component communicate through a tiny module-level
 * signal (`registerFlyoutTrigger` / `flyoutTrigger`) rather than React context —
 * the overlay is mounted once in the root layout, so a provider tree would be
 * overkill. When the overlay isn't mounted, or the user prefers reduced motion,
 * `playFlyout` falls back to a plain `router.push`.
 */

type FlyoutTrigger = (href: string) => void;

// Set by the mounted overlay; read by the hook. One overlay exists at a time.
let flyoutTrigger: FlyoutTrigger | null = null;

/** Called by the overlay component on mount/unmount to wire up the bridge. */
export function registerFlyoutTrigger(fn: FlyoutTrigger | null) {
  flyoutTrigger = fn;
}

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function useEnvelopeTransition() {
  const router = useRouter();
  /** Fly the envelope out, then navigate. Falls back to a plain push when the
   *  overlay isn't mounted or motion is reduced. */
  const playFlyout = useCallback(
    (href: string) => {
      if (flyoutTrigger && !prefersReducedMotion()) {
        flyoutTrigger(href);
      } else {
        router.push(href);
      }
    },
    [router],
  );
  return { playFlyout };
}
