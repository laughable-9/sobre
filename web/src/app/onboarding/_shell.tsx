"use client";

import { CaretLeftIcon } from "@phosphor-icons/react";

/**
 * MobileScreen: the per-step container used by the onboarding flow. Renders
 * a sticky app-bar at the top (back chevron + title + step counter), the
 * scrollable content area, and a pinned bottom CTA bar.
 *
 * Designed to fill the viewport at Mobile L (425px) and downscale cleanly.
 */
export function MobileScreen({
  title,
  step,
  total,
  onBack,
  cta,
  bgVariant = "cream",
  children,
}: {
  title?: string;
  step: number;
  total: number;
  onBack: () => void;
  cta: React.ReactNode;
  bgVariant?: "cream" | "white";
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        background: bgVariant === "white" ? "var(--surface)" : "var(--bg)",
      }}
    >
      <div
        style={{
          padding: "14px 18px 8px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: bgVariant === "white" ? "var(--surface)" : "var(--bg)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            display: "grid",
            placeItems: "center",
            color: "var(--text-1)",
          }}
        >
          <CaretLeftIcon weight="bold" size={16} />
        </button>
        <div style={{ flex: 1, textAlign: "center" }}>
          {title && (
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </div>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-3)",
            minWidth: 32,
            textAlign: "right",
          }}
        >
          {step}/{total}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: "12px 22px 24px",
          overflowY: "auto",
        }}
      >
        {children}
      </div>

      <div
        style={{
          padding: "12px 18px calc(18px + env(safe-area-inset-bottom, 0px))",
          background: bgVariant === "white" ? "var(--surface)" : "var(--bg)",
          borderTop: "1px solid var(--border)",
        }}
      >
        {cta}
      </div>
    </div>
  );
}

/** Standard pinned CTA button used at the bottom of every step. */
export function PrimaryCta({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        background: "var(--sobre-primary)",
        color: "#fff",
        border: 0,
        borderRadius: 10,
        padding: "14px 16px",
        fontSize: 15,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        boxShadow: "0 4px 12px rgba(232, 146, 60, 0.25)",
      }}
    >
      {children}
    </button>
  );
}

