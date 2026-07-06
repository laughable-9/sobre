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
 * Wrapped in a named <ViewTransition> so navigating between / and /dashboard
 * morphs the header instead of cutting (needs experimental.viewTransition in
 * next.config.ts; browsers without support just skip the animation).
 */
export function SiteHeader({
  center,
  right,
  children,
}: {
  /** Middle slot of the 1fr-auto-1fr grid (e.g. the wallet-name pill). */
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

          {center ?? <div />}

          <nav className="sobre-nav-links justify-end">{right}</nav>
        </div>
        {children}
      </header>
    </ViewTransition>
  );
}
