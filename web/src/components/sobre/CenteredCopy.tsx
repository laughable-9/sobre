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
      {/* nowrap so rotating titles never push the modal height around. If a
       *  string somehow exceeds the modal width it'll ellipsis rather than
       *  wrap onto a second line and bob the layout. */}
      <h2
        className="mb-2"
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </h2>
      {body ? <p className="sub mb-4">{body}</p> : null}
      {/* Centered footer — the shared sobre-modal-actions class right-aligns,
       *  which clashes with a centered title/body layout. Override to keep
       *  the call-to-action visually anchored to the column. */}
      {footer ? (
        <div className="sobre-modal-actions" style={{ justifyContent: "center" }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
