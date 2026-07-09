"use client";

import type { FamilySubaccountRow } from "@/hooks/useSubaccounts";
import { Avatar } from "@/components/sobre/Avatar";

/**
 * Sub-account holders — "supplementary accounts" in Sobre's own terminology
 * — rendered at the bottom of the Envelopes tab. Renders nothing when the
 * family has none and the caller isn't an admin; the section only earns
 * space when it has content to show or when the admin can add one.
 */
export function CardsSection({
  rows,
  canManage,
  onManage,
}: {
  rows: FamilySubaccountRow[];
  /** True when the viewer is an admin — surfaces the "Manage" affordance
   *  that takes them to the SubAccountsPanel for full CRUD. */
  canManage: boolean;
  onManage?: () => void;
}) {
  if (rows.length === 0 && !canManage) return null;

  return (
    <section className="sobre-envs-section" aria-label="Supplementary accounts">
      <div className="sobre-envs-section-head">
        <h3>Supplementary</h3>
        {canManage && onManage ? (
          <button
            type="button"
            className="sobre-envs-section-action"
            onClick={onManage}
          >
            {rows.length === 0 ? "Add supplementary" : "Manage"}
          </button>
        ) : null}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="sobre-member-row">
          <Avatar src={null} name={r.displayName} size={36} />
          <div className="who">
            <span className="name">{r.displayName}</span>
            <span className="role">
              {r.invitePending ? "Invite pending" : "Supplementary"}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
