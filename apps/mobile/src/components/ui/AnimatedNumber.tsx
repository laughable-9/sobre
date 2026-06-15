/**
 * Direct port of web/src/components/sobre/AnimatedNumber.tsx. The raf-based
 * easing has no DOM dependency, so it works unchanged in React Native.
 */

import { useEffect, useRef, useState } from "react";
import { Text, type TextStyle } from "react-native";

export function AnimatedNumber({
  value,
  durationMs = 800,
  format,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
}: {
  value: number;
  durationMs?: number;
  format: (n: number) => string;
  style?: TextStyle | TextStyle[];
  /** Forwarded so callers can keep a large balance on one line and let it
   *  shrink to fit on narrow screens. */
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
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

  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
    >
      {format(current)}
    </Text>
  );
}
