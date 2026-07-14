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

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    setIndex(clamped);
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }, []);

  const finish = useCallback(() => {
    markTourSeen();
    onFinish();
  }, [onFinish]);

  const primary = () => (isLast ? finish() : goTo(index + 1));

  // Keep dots in sync with native swipe / trackpad scrolling.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const next = Math.round(el.scrollLeft / w);
      if (next !== index) setIndex(next);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [index]);

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
