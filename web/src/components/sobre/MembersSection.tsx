"use client";

import type { Member } from "@/hooks/useWalletState";
import { Avatar } from "@/components/sobre/Avatar";
import { shortenAddress } from "@/lib/format";

/**
 * Compact family-members list rendered at the bottom of the Envelopes tab.
 * Admins see an "Invite" affordance when membership can grow (Sobre caps
 * families at 2 members). No emoji tiles — identity is Google-sourced.
 */
export function MembersSection({
  members,
  adminAddress,
  canInvite,
  onInvite,
}: {
  members: Member[];
  /** The C-address the contract knows as admin — flagged as "Admin". */
  adminAddress: string | null;
  canInvite: boolean;
  onInvite?: () => void;
}) {
  return (
    <section className="sobre-envs-section" aria-label="Members">
      <div className="sobre-envs-section-head">
        <h3>Members</h3>
        {canInvite && onInvite ? (
          <button
            type="button"
            className="sobre-envs-section-action"
            onClick={onInvite}
          >
            Invite
          </button>
        ) : null}
      </div>
      {members.map((m) => (
        <div key={m.address} className="sobre-member-row">
          <Avatar
            src={null}
            name={m.name || shortenAddress(m.address)}
            size={36}
          />
          <div className="who">
            <span className="name">
              {m.name || shortenAddress(m.address)}
            </span>
            <span className="role">
              {m.address === adminAddress ? "Admin" : "Member"}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
