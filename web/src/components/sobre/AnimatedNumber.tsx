"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Eases a numeric value from old to new on change. Cheap raf-based easing —
 * no library. The format function returns ReactNode so callers can split the
 * whole/cents like Fraunces big-amount layouts do.
 */
export function AnimatedNumber({
  value,
  durationMs = 800,
  format,
}: {
  value: number;
  durationMs?: number;
  format: (n: number) => React.ReactNode;
}) {
  const [current, setCurrent] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setCurrent(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span className="tabular">{format(current)}</span>;
}
