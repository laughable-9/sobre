"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRightIcon, XIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  DASHBOARD_TOUR_STEPS,
  type TourStep,
  type TourTab,
} from "@/lib/dashboardTourSteps";
import { dashTourSeen } from "@/lib/dashTourSeen";

type Rect = { top: number; left: number; width: number; height: number };
type Viewport = { w: number; h: number };

/**
 * In-app dashboard tour. Walks DASHBOARD_TOUR_STEPS, spotlighting one DOM
 * element per step and rendering a callout card next to it. All product
 * decisions (which stops, what order, copy) live in the steps file; this
 * component just renders the array.
 *
 * How positioning works: getBoundingClientRect on the target drives a
 * box-shadow-based spotlight (a single positioned div whose enormous outer
 * shadow creates the dim area) and a callout card next to it. CSS transitions
 * on the spotlight interpolate between anchors so it slides smoothly step to
 * step.
 *
 * A step with no `anchor` renders as a centered card (welcome / farewell /
 * "here's the whole page") with no spotlight.
 */
export function DashboardTour({
  isAdmin,
  currentTab,
  onSwitchTab,
  onStepChange,
  onFinish,
}: {
  isAdmin: boolean;
  currentTab: TourTab;
  /** Fires when a step needs the dashboard on a different tab. */
  onSwitchTab: (tab: TourTab) => void;
  /** Fires whenever the active step id changes, and once with `null`
   *  when the tour ends. Parent uses it to open/close side overlays
   *  (e.g. the Sobre action sheet during the "what's inside" step). */
  onStepChange?: (stepId: string | null) => void;
  /** Called when the tour completes or is skipped. Parent marks it seen
   *  in localStorage and unmounts. */
  onFinish: () => void;
}) {
  // Filter role-gated steps once. Non-admins skip admin-only stops instead
  // of seeing a callout pointing at a button they can't press.
  const steps = useMemo(
    () =>
      DASHBOARD_TOUR_STEPS.filter(
        (s) => s.requiresRole !== "admin" || isAdmin,
      ),
    [isAdmin],
  );
  const [index, setIndex] = useState(0);
  const step: TourStep | undefined = steps[index];
  const [rect, setRect] = useState<Rect | null>(null);

  // Parent-supplied callbacks are inline arrows on the dashboard page,
  // so they get new references every render (including every 3s state
  // poll). Route them through a ref so the tour's effects don't depend
  // on them and re-fire on every parent render. useLayoutEffect keeps
  // the ref current before any effect that might read it can fire.
  const cbRef = useRef({ onSwitchTab, onStepChange, onFinish });
  useLayoutEffect(() => {
    cbRef.current = { onSwitchTab, onStepChange, onFinish };
  });

  const finish = useCallback(() => {
    dashTourSeen.mark();
    cbRef.current.onStepChange?.(null);
    cbRef.current.onFinish();
  }, []);

  // Broadcast the active step id so the parent can wire side effects
  // (open a sheet, etc.). No cleanup pass: `finish` already fires the
  // terminal `null` broadcast, and a cleanup here would fire on every
  // parent re-render if `onStepChange` weren't ref-stabilised (it now is,
  // but the cleanup was never necessary anyway).
  useEffect(() => {
    cbRef.current.onStepChange?.(step?.id ?? null);
  }, [step?.id]);

  // Between anchored steps, rect is NOT reset: CSS transitions on the
  // spotlight interpolate top/left/width/height smoothly from the old
  // rect to the new one. But when the step has NO anchor (welcome /
  // settings-panel), clear rect so a later return to an anchored step
  // doesn't briefly flash the spotlight at the pre-anchor-less rect
  // before the new measurement lands.
  useEffect(() => {
    if (step && !step.anchor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
    }
  }, [step]);

  // Auto-switch tabs when the current step needs a different one. The
  // callout doesn't render until the anchor exists, so this drives the
  // dashboard to the right surface before we start hunting for the target.
  useEffect(() => {
    if (!step) return;
    if (step.requiresTab && step.requiresTab !== currentTab) {
      cbRef.current.onSwitchTab(step.requiresTab);
    }
  }, [step, currentTab]);

  // Locate the anchor and measure it. Uses the FIRST valid measurement
  // so the ring appears as soon as the target exists; no waiting for
  // stability. Two follow-up passes at 200ms and 450ms catch anchors
  // whose position settles later (e.g. the OpenSobreSheet's slide-up
  // animation, tab-switch layout shifts) and update the rect in place.
  useEffect(() => {
    if (!step?.anchor) return;
    const anchor = step.anchor;
    let cancelled = false;
    let attempt = 0;
    let raf = 0;
    const MAX_ATTEMPTS = 60; // ~60 * 16ms ≈ 960ms retry to find the anchor
    const ANIM_WAIT_ATTEMPTS = 30; // ~30 * 16ms ≈ 480ms max animation wait

    // Diff-then-commit avoids a fresh setRect object literal (and thus
    // a needless React re-render) on every follow-up pass when the
    // anchor hasn't actually moved.
    let lastCommitted: Rect | null = null;
    const commit = (r: Rect) => {
      if (
        lastCommitted &&
        lastCommitted.top === r.top &&
        lastCommitted.left === r.left &&
        lastCommitted.width === r.width &&
        lastCommitted.height === r.height
      ) {
        return;
      }
      lastCommitted = r;
      setRect(r);
    };
    const measureOnce = (): boolean => {
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${anchor}"]`,
      );
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      commit({ top: r.top, left: r.left, width: r.width, height: r.height });
      return true;
    };

    // rAF retry until the anchor exists, has non-zero size, and isn't in
    // the middle of an animation (transform slide-ups like the Sobre
    // action sheet, otherwise the ring paints at a mid-flight rect).
    // ANIM_WAIT_ATTEMPTS caps the wait so an infinite animation somewhere
    // in the subtree doesn't hang us.
    const retry = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${anchor}"]`,
      );
      if (!el) {
        attempt += 1;
        if (attempt > MAX_ATTEMPTS) {
          console.warn(
            `[DashboardTour] anchor "${anchor}" never appeared; skipping step`,
          );
          if (index < steps.length - 1) setIndex((i) => i + 1);
          else finish();
          return;
        }
        raf = requestAnimationFrame(retry);
        return;
      }
      const running =
        typeof el.getAnimations === "function"
          ? el
              .getAnimations({ subtree: true })
              .filter((a) => a.playState === "running")
          : [];
      if (running.length > 0 && attempt < ANIM_WAIT_ATTEMPTS) {
        attempt += 1;
        raf = requestAnimationFrame(retry);
        return;
      }
      if (measureOnce()) return;
      attempt += 1;
      if (attempt > MAX_ATTEMPTS) {
        console.warn(
          `[DashboardTour] anchor "${anchor}" never sized up; skipping step`,
        );
        if (index < steps.length - 1) setIndex((i) => i + 1);
        else finish();
        return;
      }
      raf = requestAnimationFrame(retry);
    };
    retry();

    // Late catches for anchors whose parent finishes animating after
    // first paint. Cheap thanks to the diff-then-commit above.
    const t1 = window.setTimeout(() => {
      if (!cancelled) measureOnce();
    }, 200);
    const t2 = window.setTimeout(() => {
      if (!cancelled) measureOnce();
    }, 450);

    // Re-measure on scroll and resize so the spotlight tracks the target.
    const onWindow = () => {
      if (!cancelled) measureOnce();
    };
    window.addEventListener("scroll", onWindow, true);
    window.addEventListener("resize", onWindow);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("scroll", onWindow, true);
      window.removeEventListener("resize", onWindow);
    };
  }, [step, index, steps.length, finish]);

  // Escape / arrow keys mirror modal semantics people expect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") {
        if (index < steps.length - 1) setIndex((i) => i + 1);
        else finish();
      }
      if (e.key === "ArrowLeft" && index > 0) setIndex((i) => i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, finish]);

  if (!step) return null;

  const isLast = index === steps.length - 1;
  const total = steps.length;
  const cardProps = {
    index,
    total,
    title: step.title,
    body: step.body,
    isLast,
    onBack: index > 0 ? () => setIndex((i) => i - 1) : undefined,
    onSkip: index === 0 ? finish : undefined,
    onNext: () => (isLast ? finish() : setIndex((i) => i + 1)),
    onClose: finish,
  };

  // Centered anchor-less step (welcome / farewell / "here's the whole page").
  if (!step.anchor) {
    // Default dimmed=true → soft scrim. dimmed=false → transparent
    // click-catcher so an overlay the parent opened (like the Sobre
    // action sheet) shows through completely.
    const scrimClass =
      step.dimmed !== false
        ? "sobre-dash-tour-scrim is-soft"
        : "sobre-dash-tour-scrim is-clear";
    // placement:"top" pins the card near the top of the viewport so an
    // open sheet/modal stays visible below it.
    const cardPositionClass =
      step.placement === "top"
        ? "sobre-dash-tour-card sobre-dash-tour-card-centered is-top"
        : "sobre-dash-tour-card sobre-dash-tour-card-centered";
    return (
      <div
        className="sobre-dash-tour"
        role="dialog"
        aria-label={step.title}
        aria-modal="true"
      >
        <div className={scrimClass} aria-hidden />
        <TourCard className={cardPositionClass} key={step.id} {...cardProps} />
      </div>
    );
  }

  const padding = step.padding ?? 8;

  // Waiting for the first measurement (very first step, before we've
  // ever measured anything). Render just the dim scrim so the page
  // doesn't flash back to the raw dashboard.
  if (!rect) {
    return (
      <div
        className="sobre-dash-tour-scrim"
        aria-hidden
        style={{ pointerEvents: "auto" }}
      />
    );
  }

  const cutout = {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
  const callout = pickCallout(cutout, currentViewport(), step.placement ?? "auto");

  return (
    <div
      className="sobre-dash-tour"
      role="dialog"
      aria-label={step.title}
      aria-modal="true"
    >
      {/* Transparent click-catcher underneath the spotlight. Absorbs
          any click that doesn't hit the callout card so users can't
          accidentally fire background UI (or the highlighted button)
          mid-tour. */}
      <div className="sobre-dash-tour-catcher" aria-hidden />

      {/* Single spotlight element. The visible dim area comes from its
          huge outer box-shadow (see CSS); the ring is stacked shadows
          on top of it. Position + size are inline so CSS transitions
          smoothly interpolate from the previous step's rect to the new
          one. */}
      <div
        className="sobre-dash-tour-spotlight"
        style={{
          top: cutout.top,
          left: cutout.left,
          width: cutout.width,
          height: cutout.height,
        }}
        aria-hidden
      />

      {/* No `key={step.id}` on purpose: React reuses this DOM node
          between anchored steps, so the CSS `transition` on top/left
          can interpolate from the previous step's position to the new
          one. A key here would remount and kill the slide. */}
      <TourCard
        className="sobre-dash-tour-card"
        style={{ top: callout.top, left: callout.left, width: callout.width }}
        {...cardProps}
      />
    </div>
  );
}

/**
 * The callout card shared by anchored and anchor-less steps. Same
 * layout (step counter, title, body, back/skip + next); the only
 * difference is where it's positioned, which the caller controls
 * via `className` + `style`.
 */
function TourCard({
  className,
  style,
  index,
  total,
  title,
  body,
  isLast,
  onBack,
  onSkip,
  onNext,
  onClose,
}: {
  className: string;
  style?: React.CSSProperties;
  index: number;
  total: number;
  title: string;
  body: string;
  isLast: boolean;
  /** Present when there's a previous step to go back to. */
  onBack?: () => void;
  /** Present on the first step in place of Back. */
  onSkip?: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className={className} style={style}>
      <button
        type="button"
        className="sobre-dash-tour-close"
        onClick={onClose}
        aria-label={isLast ? "Close tour" : "Skip tour"}
      >
        <XIcon weight="bold" size={16} />
      </button>
      <div className="sobre-dash-tour-step-count">
        {index + 1} of {total}
      </div>
      <h2 className="sobre-dash-tour-title">{title}</h2>
      <p className="sobre-dash-tour-body">{body}</p>
      <div className="sobre-dash-tour-actions">
        {onBack ? (
          <button
            type="button"
            className="sobre-dash-tour-back"
            onClick={onBack}
          >
            Back
          </button>
        ) : onSkip ? (
          <button
            type="button"
            className="sobre-dash-tour-back"
            onClick={onSkip}
          >
            Skip
          </button>
        ) : (
          <span />
        )}
        <Button onClick={onNext} size="sm" className="sobre-dash-tour-next">
          {isLast ? "Let's go" : "Next"}
          {isLast ? null : <ArrowRightIcon weight="bold" size={14} />}
        </Button>
      </div>
    </div>
  );
}

const CARD_WIDTH = 300;
const CARD_MIN_HEIGHT = 180;
const CARD_GAP = 14;
const VIEWPORT_MARGIN = 16;

function currentViewport(): Viewport {
  if (typeof window === "undefined") return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Pick a callout position that stays fully on-screen. Preferred side is a
 * hint; if it would clip we flip to whichever side has room. Falls back to
 * centering below the cutout when the target eats most of the viewport.
 */
function pickCallout(
  cutout: Rect,
  viewport: Viewport,
  preferred: "top" | "bottom" | "left" | "right" | "auto",
) {
  const w = Math.min(CARD_WIDTH, viewport.w - VIEWPORT_MARGIN * 2);
  const spaceAbove = cutout.top - VIEWPORT_MARGIN;
  const spaceBelow = viewport.h - (cutout.top + cutout.height) - VIEWPORT_MARGIN;
  const spaceRight = viewport.w - (cutout.left + cutout.width) - VIEWPORT_MARGIN;
  const spaceLeft = cutout.left - VIEWPORT_MARGIN;

  const canBelow = spaceBelow >= CARD_MIN_HEIGHT + CARD_GAP;
  const canAbove = spaceAbove >= CARD_MIN_HEIGHT + CARD_GAP;
  const canRight = spaceRight >= w + CARD_GAP;
  const canLeft = spaceLeft >= w + CARD_GAP;

  let side: "top" | "bottom" | "left" | "right" = "bottom";
  if (preferred === "bottom" && canBelow) side = "bottom";
  else if (preferred === "top" && canAbove) side = "top";
  else if (preferred === "right" && canRight) side = "right";
  else if (preferred === "left" && canLeft) side = "left";
  else if (canBelow) side = "bottom";
  else if (canAbove) side = "top";
  else if (canRight) side = "right";
  else if (canLeft) side = "left";
  else side = "bottom";

  let top = 0;
  let left = 0;
  if (side === "bottom") {
    top = cutout.top + cutout.height + CARD_GAP;
    left = clamp(
      cutout.left + cutout.width / 2 - w / 2,
      VIEWPORT_MARGIN,
      viewport.w - w - VIEWPORT_MARGIN,
    );
  } else if (side === "top") {
    top = Math.max(
      VIEWPORT_MARGIN,
      cutout.top - CARD_MIN_HEIGHT - CARD_GAP,
    );
    left = clamp(
      cutout.left + cutout.width / 2 - w / 2,
      VIEWPORT_MARGIN,
      viewport.w - w - VIEWPORT_MARGIN,
    );
  } else if (side === "right") {
    top = clamp(
      cutout.top + cutout.height / 2 - CARD_MIN_HEIGHT / 2,
      VIEWPORT_MARGIN,
      viewport.h - CARD_MIN_HEIGHT - VIEWPORT_MARGIN,
    );
    left = cutout.left + cutout.width + CARD_GAP;
  } else {
    top = clamp(
      cutout.top + cutout.height / 2 - CARD_MIN_HEIGHT / 2,
      VIEWPORT_MARGIN,
      viewport.h - CARD_MIN_HEIGHT - VIEWPORT_MARGIN,
    );
    left = Math.max(VIEWPORT_MARGIN, cutout.left - w - CARD_GAP);
  }

  return { top, left, width: w };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}
