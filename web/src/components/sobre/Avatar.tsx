"use client";

import { useState, type CSSProperties } from "react";

import { initialsOf } from "@/lib/format";

/**
 * Circular identity avatar. Renders the Google profile picture when we have
 * one; otherwise falls back to initials on a solid, name-derived background
 * so each person has a stable colour. Never shows an emoji.
 */
export function Avatar({
  name,
  src,
  size = 36,
  style,
}: {
  name: string;
  src?: string | null;
  size?: number;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
          ...style,
        }}
      />
    );
  }

  const bg = backgroundFor(name.trim());
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-grid",
        placeItems: "center",
        background: bg,
        color: "#fff",
        fontFamily: "var(--font-manrope), var(--font-sans), sans-serif",
        fontWeight: 600,
        fontSize: Math.round(size * 0.42),
        lineHeight: 1,
        letterSpacing: 0.4,
        userSelect: "none",
        ...style,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Deterministic pick from a small palette of Sobre-brand tones. Same name
 *  always gets the same colour across the app. */
const AVATAR_PALETTE = [
  "var(--sobre-accent)",
  "var(--sobre-primary)",
  "var(--sobre-primary-hover)",
] as const;

function backgroundFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
