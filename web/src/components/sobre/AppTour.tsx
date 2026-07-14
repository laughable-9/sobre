"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRightIcon,
  ChartPieSliceIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { LOGO_SRC } from "@/lib/config";

const TOUR_SEEN_KEY = "sobre-tour-seen";

/** Has the user finished (or skipped) the intro tour before? Reads
 *  localStorage; returns `false` on server + before hydration. */
export function hasSeenTour(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markTourSeen() {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    /* private-mode etc. — ok to ignore, tour just shows next time */
  }
}

type Slide = {
  visual: React.ReactNode;
  title: React.ReactNode;
  body: string;
};

const SLIDES: Slide[] = [
  {
    visual: (
      <Image
        src={LOGO_SRC}
        alt=""
        width={92}
        height={92}
        priority
      />
    ),
    title: (
      <>
        One Sobre.
        <br />
        One Family.
      </>
    ),
    body: "The shared family wallet built for overseas workers and the people they send money home to.",
  },
  {
    visual: <ChartPieSliceIcon weight="fill" size={92} />,
    title: <>Money splits itself.</>,
    body: "Every deposit auto-splits into Groceries, Tuition, and Savings the moment it arrives.",
  },
  {
    visual: <UsersThreeIcon weight="fill" size={92} />,
    title: <>See it together.</>,
    body: "Both sides see the same balances in real time. Nothing hidden. Nothing to argue about.",
  },
];

export function AppTour({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const total = SLIDES.length;
  const isLast = index === total - 1;

  const isSmoothScrollingRef = useRef(false);
  const smoothScrollResetRef = useRef<number | null>(null);
  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    setIndex(clamped);
    const el = scrollerRef.current;
    // clientWidth === 0 when the scroller mounted inside a hidden ancestor —
    // scrollTo would silently no-op and leave the dot advanced past the visible
    // slide. Bail so the caller can retry after layout settles.
    if (!el || el.clientWidth === 0) return;
    // Suppress the onScroll dot-sync while the browser smooth-scrolls between
    // slides, otherwise every intermediate scrollLeft flicker fights the click
    // and the dot bounces through slides we're passing over. Reset ref is
    // cancel-safe so a rapid double-goTo doesn't stack overlapping timers.
    isSmoothScrollingRef.current = true;
    if (smoothScrollResetRef.current !== null) {
      clearTimeout(smoothScrollResetRef.current);
    }
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    smoothScrollResetRef.current = window.setTimeout(() => {
      isSmoothScrollingRef.current = false;
      smoothScrollResetRef.current = null;
    }, 500);
  }, []);
  // Cancel the pending reset on unmount so it doesn't fire on a stale ref.
  useEffect(() => {
    return () => {
      if (smoothScrollResetRef.current !== null) {
        clearTimeout(smoothScrollResetRef.current);
      }
    };
  }, []);

  const finish = useCallback(() => {
    markTourSeen();
    onFinish();
  }, [onFinish]);

  const primary = () => (isLast ? finish() : goTo(index + 1));

  // Keep dots in sync with native swipe / trackpad scrolling. Skip while a
  // programmatic smooth-scroll is in flight so intermediate scrollLeft
  // frames don't drag the dot back through slides being swept past.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isSmoothScrollingRef.current) return;
      const w = el.clientWidth;
      if (w === 0) return;
      const next = Math.round(el.scrollLeft / w);
      if (next !== index) setIndex(next);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [index]);

  // Realign scroll offset to the active index on viewport resize / rotation
  // so the visible slide and the active dot don't desync after the user
  // rotates their phone mid-tour.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onResize = () => {
      if (el.clientWidth === 0) return;
      el.scrollLeft = index * el.clientWidth;
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [index]);

  // Cross-tab: if another tab completes the tour, mark this one done too
  // so both tabs stop showing it. Uses the storage event which fires only
  // in OTHER tabs of the same origin.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOUR_SEEN_KEY) return;
      if (e.newValue === "1") onFinish();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [onFinish]);

  return (
    <div className="sobre-tour">
      <div className="sobre-tour-topbar">
        <button
          type="button"
          onClick={finish}
          className="sobre-tour-skip"
          aria-label="Skip tour"
        >
          Skip
        </button>
      </div>

      <div
        ref={scrollerRef}
        className="sobre-tour-scroller"
        aria-roledescription="carousel"
      >
        {SLIDES.map((slide, i) => (
          <section
            key={i}
            className="sobre-tour-slide"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}`}
          >
            <div className="sobre-tour-visual" style={{ color: "var(--sobre-primary)" }}>
              {slide.visual}
            </div>
            <h1 className="sobre-tour-title">{slide.title}</h1>
            <p className="sobre-tour-body">{slide.body}</p>
          </section>
        ))}
      </div>

      <div className="sobre-tour-footer">
        <div className="sobre-tour-dots" role="tablist" aria-label="Tour progress">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={`sobre-tour-dot${i === index ? " active" : ""}`}
            />
          ))}
        </div>
        <Button onClick={primary} size="lg" className="sobre-tour-cta">
          {isLast ? "Get started" : "Next"}
          <ArrowRightIcon weight="bold" size={16} />
        </Button>
      </div>
    </div>
  );
}
