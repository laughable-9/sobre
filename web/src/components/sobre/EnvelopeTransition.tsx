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
  // Snapshot of the pathname when the cover was triggered. The readiness
  // watcher requires pathname to move AWAY from this before flipping
  // routeReadyRef — otherwise the phase-transition-to-cover itself re-runs
  // the effect (with the source pathname still current) and immediately
  // marks route ready, so the cover sweeps away as soon as its cover-in
  // animation finishes (~1.25s) while the destination is still fetching.
  const startPathname = useRef<string | null>(null);
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
      // Clear any timers left over from a prior trigger (rapid double-click
      // on "Open a Sobre" used to leave the previous cycle's router.push
      // and force-reveal timers armed, so they'd fire during the new one).
      if (navTimer.current) {
        clearTimeout(navTimer.current);
        navTimer.current = null;
      }
      if (capTimer.current) {
        clearTimeout(capTimer.current);
        capTimer.current = null;
      }
      // 1. Cover the screen with the green envelope panel, and start the
      //    navigation. The cover HOLDS (CSS keeps the panel on-screen) until the
      //    route is ready — see the readiness watcher below — so a slow load
      //    stays hidden behind the cover instead of revealing a blank page.
      targetPath.current = href;
      startPathname.current = pathname;
      coveredRef.current = false;
      routeReadyRef.current = false;
      setPhase("cover");
      router.prefetch?.(href);
      // Kick navigation off once the cover is fully down. The beats are
      // sequenced: beat 0 (~0.75s) then the panel sweep (0.55s, delayed 0.7s),
      // so the screen is fully green around ~1.25s — navigate then so the heavy
      // route mount is hidden behind the cover.
      navTimer.current = window.setTimeout(() => {
        startTransition(() => router.push(href));
      }, 1250);
      // Safety cap: never hold the cover longer than MAX_COVER_MS. Force both
      // gates open and reveal so the user is never trapped under the cover.
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

  // Readiness watcher: pathname moving AWAY from the start snapshot means
  // the router has settled on a new route (target or back-nav either way).
  // Gating on this (rather than the naive "effect fires during cover")
  // stops the effect from marking route-ready on the initial cover-phase
  // render — which would let the cover sweep away as soon as the cover-in
  // animation ends, before the destination page has actually mounted.
  //
  // Gating on coveredRef in maybeReveal prevents revealing from a half-
  // covered panel (the "giant V stuck mid-screen" bug).
  useEffect(() => {
    if (phase !== "cover") return;
    if (pathname === startPathname.current) return;
    if (!targetPath.current) return;
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

  // Safety net for the reveal phase: if the sweep-out animation is
  // interrupted (tab hidden mid-animation, browser suspends timers under
  // memory pressure, reduced-motion kicks in), animationend never fires
  // and the overlay stays mounted forever. Force-unmount 2s after the
  // reveal begins — the sweep itself is ~1.1s + a bit of margin.
  useEffect(() => {
    if (phase !== "reveal") return;
    const t = window.setTimeout(() => setPhase("idle"), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div
      className={`sobre-env-overlay ${phase}`}
      onAnimationEnd={handleAnimationEnd}
      aria-hidden
    >
      {/* Structure mirrors .sobre-tour exactly (topbar / slide with visual +
          title + body / footer) with everything but the title made invisible.
          Guarantees the title lands at the same y as the tour title regardless
          of viewport size or safe-area — no math on our part. */}
      <div className="sobre-tour-topbar" style={{ visibility: "hidden" }}>
        <button type="button" className="sobre-tour-skip" tabIndex={-1}>
          Skip
        </button>
      </div>
      <div className="sobre-tour-scroller">
        <section className="sobre-tour-slide">
          <div
            className="sobre-tour-visual"
            style={{ visibility: "hidden" }}
            aria-hidden
          />
          <h1 className="sobre-tour-title sobre-cover-text">
            One Sobre.
            <br />
            One Family.
          </h1>
          <p
            className="sobre-tour-body"
            style={{ visibility: "hidden" }}
            aria-hidden
          >
            The shared family wallet built for overseas workers and the people
            they send money home to.
          </p>
        </section>
      </div>
      <div
        className="sobre-tour-footer"
        style={{ visibility: "hidden" }}
        aria-hidden
      >
        <div className="sobre-tour-dots">
          <span className="sobre-tour-dot active" />
          <span className="sobre-tour-dot" />
          <span className="sobre-tour-dot" />
        </div>
        <button className="sobre-tour-cta" tabIndex={-1}>
          Next
        </button>
      </div>
    </div>
  );
}