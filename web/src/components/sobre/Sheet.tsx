"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { backdropClose } from "@/lib/ui";

/**
 * Every dismissable overlay in the app. Owns the backdrop, the modal
 * shell, portal-to-body (so no ancestor stacking context can trap it
 * behind the dock), the slide-up open + slide-down close animations,
 * and the mobile drag-to-close gesture. Consumers just render their
 * content inside.
 *
 * Modals with a close guard (multi-step flows where "user clicked
 * outside" should NOT dismiss during certain phases) pass a `dismiss`
 * that funnels through their guard. The wrapper still plays the exit
 * animation before invoking it.
 */
export function Sheet({
  onClose,
  canClose = true,
  children,
  className,
  draggable = true,
  role = "dialog",
  ariaLabel,
}: {
  /** Called after the exit animation runs. Wire in any guard here (e.g.
   *  PdaxDepositModal's "don't close while paying"). */
  onClose: () => void;
  /** When false, backdrop clicks and drag-to-close do nothing — the modal
   *  can only be dismissed by a caller-owned button or when the phase
   *  gate flips. Prevents "half-closed" state where the exit animation
   *  runs but the parent's onClose returns early on a locked phase. */
  canClose?: boolean;
  children: React.ReactNode;
  /** Extra className on the inner `.sobre-modal` — for size overrides
   *  or per-modal styling hooks. */
  className?: string;
  /** Mobile bottom-sheet drag-to-close. Default on. Set false for flows
   *  where an accidental drag would strand state (multi-step wizards). */
  draggable?: boolean;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const dragStartRef = useRef<number | null>(null);
  const CLOSE_THRESHOLD = 100;
  const CLOSE_ANIM_MS = 220;

  // Every dismiss path flips `closing`; the effect below schedules the
  // real onClose after the slide-down animation and cleans up if the
  // parent unmounts under us.
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onClose, CLOSE_ANIM_MS);
    return () => window.clearTimeout(t);
  }, [closing, onClose]);

  const beginClose = () => {
    if (!canClose) return;
    if (!closing) setClosing(true);
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    const delta = e.clientY - dragStartRef.current;
    setDragY(delta > 0 ? delta : 0);
  };
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
    setDragging(false);
    if (dragY > CLOSE_THRESHOLD) {
      // Reset the inline translate so the CSS keyframe animation runs
      // from its "at rest" from-frame instead of jumping past it.
      setDragY(0);
      beginClose();
    } else {
      setDragY(0);
    }
  };

  // SSR guard: window is only touched on the client, and we return null
  // during server rendering to keep the markup identical either way.
  if (typeof window === "undefined") return null;

  const content = (
    <div
      className={`sobre-modal-bg${closing ? " closing" : ""}`}
      onMouseDown={backdropClose(beginClose)}
    >
      <div
        className={`sobre-modal has-own-handle${closing ? " closing" : ""}${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : "transform 0.2s ease",
        }}
      >
        {draggable ? (
          <div
            className="sobre-sheet-handle-strip"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            aria-hidden
          >
            <div className="sobre-sheet-handle" />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
