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
    <div
      className="sobre-celebration"
      style={kind === "warn" ? { background: "#b88b1c" } : {}}
      role="status"
    >
      {kind === "warn" ? (
        <AlertTriangle size={16} strokeWidth={2} />
      ) : (
        <Check size={16} strokeWidth={2.5} />
      )}
      {message}
    </div>
  );
}
