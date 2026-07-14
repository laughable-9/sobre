/// <reference types="react/canary" />
"use client";

import { ViewTransition, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { LOGO_SRC } from "@/lib/config";

/** Hide the topbar when the user scrolls DOWN past a small buffer, show it the
 *  moment they scroll UP. Ignores tiny jitters (< 4px), and always keeps the
 *  bar visible in the first 40px so a "scroll to top" click always lands on a
 *  visible chrome. Same behavior on every surface — landing + app. */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (Math.abs(delta) > 4) {
          if (y < 40) setHidden(false);
          else if (delta > 0) setHidden(true);
          else setHidden(false);
          lastY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}

/**
 * The one site header. Both the landing page nav and the app TopBar render
 * through this shell so the brand, height, border, and container metrics are
 * identical everywhere — only the center / right clusters differ per surface.
 *
 * Layout: brand + optional center + right cluster, laid out with flex so the
 * right cluster never wraps to a new row on narrow phones. When no `center`
 * slot is provided the header stays two-column (brand | right).
 *
 * Wrapped in a named <ViewTransition> so navigating between / and /dashboard
 * morphs the header instead of cutting (needs experimental.viewTransition in
 * next.config.ts; browsers without support just skip the animation).
 */
export function SiteHeader({
  showBrand = true,
  variant = "app",
  center,
  right,
  children,
}: {
  /** Show the "🌱 Sobre" wordmark on the left. Landing + marketing surfaces
   *  keep it on; authenticated shell pages (My Sobres, invite, onboarding)
   *  hide it — identity is implicit and the wordmark just competes with the
   *  page title. */
  showBrand?: boolean;
  /** "app" (default) renders the flat sticky bar used across the dashboard.
   *  "landing" swaps to the floating envelope-flap pill treatment — a
   *  rounded rectangle inset from the top with a subtle V-notch on its
   *  bottom edge, echoing the fold of an envelope flap. */
  variant?: "app" | "landing";
  /** Middle slot (e.g. wallet-name pill). Hidden on narrow viewports. */
  center?: React.ReactNode;
  /** Right-aligned cluster (nav links, wallet menu, CTAs). */
  right?: React.ReactNode;
  /** Rendered below the header row, still inside the sticky bar (errors). */
  children?: React.ReactNode;
}) {
  const hidden = useHideOnScrollDown();
  return (
    <ViewTransition name="sobre-header">
      <header
        className={`sobre-topbar${variant === "landing" ? " sobre-topbar-flap" : ""}${hidden ? " sobre-topbar-hidden" : ""}`}
      >
        <div className="sobre-topbar-inner">
          {showBrand ? (
            <Link href="/" className="sobre-brand">
              <Image
                src={LOGO_SRC}
                alt=""
                width={28}
                height={28}
                priority
              />
              <span className="sobre-brand-name">Sobre</span>
            </Link>
          ) : null}

          {center ? <div className="sobre-topbar-center">{center}</div> : null}

          <nav className="sobre-nav-links">{right}</nav>
        </div>
        {children}
      </header>
    </ViewTransition>
  );
}
