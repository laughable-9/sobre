/// <reference types="react/canary" />
"use client";

import { ViewTransition } from "react";
import Image from "next/image";
import Link from "next/link";

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
  center,
  right,
  children,
}: {
  /** Show the "🌱 Sobre" wordmark on the left. Landing + marketing surfaces
   *  keep it on; authenticated shell pages (My Sobres, invite, onboarding)
   *  hide it — identity is implicit and the wordmark just competes with the
   *  page title. */
  showBrand?: boolean;
  /** Middle slot (e.g. wallet-name pill). Hidden on narrow viewports. */
  center?: React.ReactNode;
  /** Right-aligned cluster (nav links, wallet menu, CTAs). */
  right?: React.ReactNode;
  /** Rendered below the header row, still inside the sticky bar (errors). */
  children?: React.ReactNode;
}) {
  return (
    <ViewTransition name="sobre-header">
      <header className="sobre-topbar">
        <div className="sobre-topbar-inner">
          {showBrand ? (
            <Link href="/" className="sobre-brand">
              <Image
                src="/sobre-logo2.svg"
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
