"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wraps a section so it fades + slides into view the first time it scrolls
 * near the viewport, giving the page a gentle, app-like momentum. Once
 * revealed it stays put (no re-hiding on scroll-up).
 *
 * Hydration: the element ALWAYS renders without `is-visible` on both server
 * and client so the markup matches — the reveal is toggled afterwards on the
 * client. If IntersectionObserver is unavailable we reveal immediately in the
 * effect by adding the class to the DOM node directly (no state, so content is
 * never stranded invisible). Reduced-motion is handled in CSS, where
 * `.sobre-reveal` collapses to a no-op.
 */
export function Reveal({
  children,
  as: Tag = "div",
  className,
  ...rest
}: {
  children: React.ReactNode;
  as?: "div" | "section";
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (old browser): just show it. Done via the DOM
    // node rather than setState so we don't fire a render inside the effect.
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = `sobre-reveal${visible ? " is-visible" : ""}${
    className ? ` ${className}` : ""
  }`;

  // Tag is a constrained string union, safe to use as a dynamic element.
  const Element = Tag as React.ElementType;
  return (
    <Element
      ref={ref as React.Ref<HTMLElement>}
      className={cls}
      {...rest}
    >
      {children}
    </Element>
  );
}