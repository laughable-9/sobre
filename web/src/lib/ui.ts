/**
 * Shared UI helpers used across multiple components.
 */

import type { MouseEvent } from "react";

/**
 * Backdrop click handler that only fires when the user actually clicked the
 * backdrop itself, not a child element. Without this, drag-selecting text
 * inside a modal that ends past its edge triggers onClick on the backdrop
 * and closes the modal mid-selection.
 *
 * Use on a modal's outer .sobre-modal-bg element as `onMouseDown`.
 */
export function backdropClose(onClose: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
}
