"use client";

import Link from "next/link";
import {
  CaretLeftIcon,
} from "@phosphor-icons/react";

/**
 * Unified back-navigation pill. One look everywhere: chevron + label in a
 * bordered surface pill with a real (≥36px) tap target, instead of the faint
 * bare-text links that varied per screen. Renders a <Link> when `href` is
 * given, a <button> when `onClick` is.
 */
export function BackLink({
  href,
  onClick,
  label = "My Sobres",
  className,
}: {
  href?: string;
  onClick?: () => void;
  label?: string;
  className?: string;
}) {
  const inner = (
    <>
      <CaretLeftIcon weight="bold" size={16} />
      {label}
    </>
  );
  const style: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "8px 14px 8px 10px",
    color: "var(--text-1)",
    fontSize: 13,
    fontWeight: 600,
    boxShadow: "var(--shadow-sm)",
    minHeight: 36,
  };
  const cls = `sobre-backlink inline-flex items-center gap-1 select-none ${className ?? ""}`;

  if (href) {
    return (
      <Link href={href} className={cls} style={style}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {inner}
    </button>
  );
}
