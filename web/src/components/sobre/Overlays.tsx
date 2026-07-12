"use client";

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

export function HeroPulse() {
  return <div className="sobre-hero-pulse" aria-hidden />;
}

/** Toast body length above which the celebration collapses to a truncated
 *  preview with a "Show more" affordance. Sanitizing at the source
 *  (friendlyError) covers the common case; this is a safety net for
 *  anything unmapped. Exported so `flash` can key its dwell-time bump
 *  off the same threshold instead of drifting from a duplicated literal. */
export const TRUNCATE_CHAR_LIMIT = 90;

export function Celebration({
  message,
  kind = "ok",
}: {
  message: string;
  kind?: "ok" | "warn";
}) {
  const [expanded, setExpanded] = useState(false);
  const long = message.length > TRUNCATE_CHAR_LIMIT;

  return (
    <div
      className="sobre-celebration"
      data-kind={kind}
      data-long={long ? "" : undefined}
      data-expanded={expanded ? "" : undefined}
      role="status"
    >
      <span className="ic" aria-hidden>
        {kind === "warn" ? (
          <AlertTriangle size={13} strokeWidth={2.4} />
        ) : (
          <Check size={13} strokeWidth={2.8} />
        )}
      </span>
      <span className="body">{message}</span>
      {long ? (
        <button
          type="button"
          className="more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
