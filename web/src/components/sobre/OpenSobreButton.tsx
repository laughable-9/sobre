"use client";

import Link from "next/link";

import { useEnvelopeTransition } from "@/hooks/useEnvelopeTransition";

/**
 * "Open a Sobre" CTA that plays the envelope fly-out transition before
 * navigating to the dashboard. Renders as a real anchor (so it's still a
 * proper link, right-click-openable, keyboard-activatable) but intercepts
 * the plain click to run the animation first. Modifier-clicks and the
 * reduced-motion path fall through to normal navigation.
 */
export function OpenSobreButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { playFlyout } = useEnvelopeTransition();
  return (
    <Link
      href="/dashboard"
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        playFlyout("/dashboard");
      }}
    >
      {children}
    </Link>
  );
}
