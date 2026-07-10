"use client";

import { AlertTriangle, Check } from "lucide-react";

export function HeroPulse() {
  return <div className="sobre-hero-pulse" aria-hidden />;
}

export function Celebration({
  message,
  kind = "ok",
}: {
  message: string;
  kind?: "ok" | "warn";
}) {
  return (
    <div className="sobre-celebration" data-kind={kind} role="status">
      <span className="ic" aria-hidden>
        {kind === "warn" ? (
          <AlertTriangle size={13} strokeWidth={2.4} />
        ) : (
          <Check size={13} strokeWidth={2.8} />
        )}
      </span>
      {message}
    </div>
  );
}
