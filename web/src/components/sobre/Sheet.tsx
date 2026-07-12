"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { backdropClose } from "@/lib/ui";

/**
 * Every dismissable overlay in the app. Owns the backdrop, the modal
 * shell, portal-to-body (so no ancestor stacking context can trap it
 * behind the dock), and the slide-up open + slide-down close animations.
 * Consumers just render their content inside.
 *
 * Modals with a close guard (multi-step flows where "user clicked
 * outside" should NOT dismiss during certain phases) pass a `canClose`
 * that funnels through their guard. The wrapper still plays the exit
 * animation before invoking it.
 */
export function Sheet({
  onClose,
  canClose = true,
  children,
  className,
  role = "dialog",
  ariaLabel,
}: {
  /** Called after the exit animation runs. Wire in any guard here (e.g.
   *  PdaxDepositModal's "don't close while paying"). */
  onClose: () => void;
  /** When false, backdrop clicks do nothing — the modal can only be
   *  dismissed by a caller-owned button or when the phase gate flips. */
  canClose?: boolean;
  children: React.ReactNode;
  /** Extra className on the inner `.sobre-modal` — for size overrides
   *  or per-modal styling hooks. */
  className?: string;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
}) {
  const [closing, setClosing] = useState(false);
  const CLOSE_ANIM_MS = 220;

  // Every dismiss path flips `closing`; the effect below schedules the
  // real onClose after the slide-down animation and cleans up if the
  // parent unmounts under us.
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onClose, CLOSE_ANIM_MS);
    return () => window.clearTimeout(t);
  }, [closing, onClose]);

  // SSR guard: window is only touched on the client, and we return null
  // during server rendering to keep the markup identical either way.
  if (typeof window === "undefined") return null;

  const content = (
    <div
      className={`sobre-modal-bg${closing ? " closing" : ""}`}
      onMouseDown={backdropClose(() => {
        if (canClose && !closing) setClosing(true);
      })}
    >
      <div
        className={`sobre-modal${closing ? " closing" : ""}${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
