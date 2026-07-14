"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { registerFlyoutTrigger } from "@/hooks/useEnvelopeTransition";

/**
 * Plain orange page-transition overlay. Mounted once in the root layout so it
 * survives route changes and can animate over the destination.
 *
 * A CTA calls `playFlyout(href)` (from `useEnvelopeTransition`) → a green
 * panel with the brand line "One Sobre. One Family." sweeps in to COVER,
 * holds while the destination route mounts (so a slow connection never reveals
 * a blank page), then sweeps away to REVEAL the dashboard.
 *
 * Respects prefers-reduced-motion: the hook skips the overlay entirely and
 * navigates immediately. The hook ↔ overlay bridge lives in the hook file.
 */

// "cover": the orange panel sweeps in and HOLDS over the page while we navigate.
// "reveal": once the destination route has mounted (or a safety cap fires), the
// panel sweeps away to uncover it. Coupling the reveal to load readiness keeps a
// slow connection hidden behind the cover instead of flashing a blank page.
type Phase = "idle" | "cover" | "reveal";

// Hard ceiling on how long we hold the cover waiting for a slow/stalled route
// so the user is never trapped under the cover. Reveals anyway after this.
// Sized for the dashboard: initial mount does Supabase auth + wallets query +
// on-chain get_state simulation before the skeleton settles.
const MAX_COVER_MS = 8000;

export function EnvelopeTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const navTimer = useRef<number | null>(null);
  const capTimer = useRef<number | null>(null);
  const targetPath = useRef<string | null>(null);
  // Reveal only when BOTH are true: the cover panel has fully finished sweeping
  // in (so we never reveal from a half-covered state), AND the destination route
  // has mounted. Tracked as refs so either trigger can check the other.
  const coveredRef = useRef(false);
  const routeReadyRef = useRef(false);

  const maybeReveal = useCallback(() => {
    if (!coveredRef.current || !routeReadyRef.current) return;
    if (capTimer.current) clearTimeout(capTimer.current);
    setPhase("reveal");
  }, []);

  // Register the fly-out trigger for the CTA hook while mounted.
  useEffect(() => {
    registerFlyoutTrigger((href: string) => {
      // 1. Cover the screen with the orange envelope panel, and start the
      //    navigation. The cover HOLDS (CSS keeps the panel on-screen) until the
      //    route is ready — see the readiness watcher below — so a slow load
      //    stays hidden behind the cover instead of revealing a blank page.
      targetPath.current = href;
      coveredRef.current = false;
      routeReadyRef.current = false;
      setPhase("cover");
      router.prefetch?.(href);
      // Kick navigation off once the cover is fully down. The beats are
      // sequenced: beat 0 (~0.75s) then the panel sweep (0.55s, delayed 0.7s),
      // so the screen is fully orange around ~1.25s — navigate then so the heavy
      // route mount is hidden behind the cover.
      navTimer.current = window.setTimeout(() => {
        startTransition(() => router.push(href));
      }, 1250);
      // Safety cap: never hold the cover longer than MAX_COVER_MS. Force both
      // gates open and reveal so the user is never trapped under the orange.
      capTimer.current = window.setTimeout(() => {
        targetPath.current = null;
        coveredRef.current = true;
        routeReadyRef.current = true;
        setPhase("reveal");
      }, MAX_COVER_MS);
    });
    return () => {
      registerFlyoutTrigger(null);
      if (navTimer.current) clearTimeout(navTimer.current);
      if (capTimer.current) clearTimeout(capTimer.current);
    };
  }, [router]);

  // Readiness watcher: when the URL actually changes to the target route (= the
  // destination has mounted), mark the route ready and reveal IF the cover has
  // also finished sweeping in. Gating on coveredRef prevents revealing from a
  // half-covered panel (the "giant V stuck mid-screen" bug).
  useEffect(() => {
    if (phase !== "cover") return;
    if (!targetPath.current || pathname !== targetPath.current) return;
    targetPath.current = null;
    routeReadyRef.current = true;
    maybeReveal();
  }, [phase, pathname, maybeReveal]);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    // When the cover panel has FULLY swept in, mark covered and reveal if the
    // route is also ready. This is what prevents revealing from a half-covered
    // state (the "giant V stuck mid-screen" bug).
    if (e.animationName === "sobre-cover-in") {
      coveredRef.current = true;
      maybeReveal();
      return;
    }
    // When the REVEAL sweep-out finishes, unmount the overlay so it never
    // lingers as a stuck node.
    if (e.animationName === "sobre-cover-out") {
      setPhase("idle");
    }
  };

  if (phase === "idle") return null;

  return (
    <div
      className={`sobre-env-overlay ${phase}`}
      onAnimationEnd={handleAnimationEnd}
      aria-hidden
    >
      {/* Plain orange cover with the brand line. Sweeps in to cover, holds while
          the route loads, then sweeps away to reveal — no envelope graphics. */}
      <p className="sobre-cover-text">
        One Sobre.
        <br />
        One Family.
      </p>
    </div>
  );
}