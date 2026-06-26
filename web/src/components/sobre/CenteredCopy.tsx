"use client";

/**
 * Centered icon-bubble + title + body + footer, used by terminal/in-flight
 * states in the PDAX deposit and withdraw modals. Layout-only — no logic.
 */
export function CenteredCopy({
  icon,
  title,
  body,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  /** Optional sub-line under the title. Omit when the title carries the
   *  message on its own. */
  body?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="text-center py-4">
      <div
        className="grid place-items-center mx-auto mb-4"
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          color: "var(--sobre-accent)",
        }}
      >
        {icon}
      </div>
      <h2 className="mb-2">{title}</h2>
      {body ? <p className="sub mb-4">{body}</p> : null}
      {footer ? <div className="sobre-modal-actions">{footer}</div> : null}
    </div>
  );
}
