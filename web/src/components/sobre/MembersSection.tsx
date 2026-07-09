"use client";

import { useCallback, useState } from "react";
import { CheckIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";

import type { Member } from "@/hooks/useWalletState";
import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import { Avatar } from "@/components/sobre/Avatar";
import { MAX_ADMIN_CAP } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { shortenAddress } from "@/lib/format";

/**
 * Compact family-members list rendered at the bottom of the Envelopes tab.
 * Admins see an "Invite" affordance when membership can grow (Sobre caps
 * families at 2 members by default). Also carries the household admin cap
 * (`N of M admins`) with an inline editor so admins can raise or lower it
 * without a separate settings card — the cap constrains what this section
 * shows, so the control belongs here.
 */
export function MembersSection({
  members,
  adminAddress,
  adminCount,
  adminCap,
  familyWalletId,
  canInvite,
  canEditCap,
  onInvite,
  onCapChanged,
}: {
  members: Member[];
  /** The C-address the contract knows as admin — flagged as "Admin". */
  adminAddress: string | null;
  adminCount: number;
  adminCap: number;
  familyWalletId: string | null;
  canInvite: boolean;
  /** True when the caller is an admin — enables the inline cap editor.
   *  The RLS policy on family_wallets already gates the write, but this
   *  keeps the UI honest for non-admin viewers. */
  canEditCap: boolean;
  onInvite?: () => void;
  onCapChanged?: () => void;
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
      <div className="sobre-envs-section-hint">
        <span>
          <b>{adminCount}</b> of <b>{adminCap}</b> admin
          {adminCap === 1 ? "" : "s"}
        </span>
        {canEditCap && familyWalletId ? (
          <AdminCapEditor
            familyWalletId={familyWalletId}
            currentCap={adminCap}
            adminCount={adminCount}
            onChanged={onCapChanged}
          />
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

/** Inline cap adjuster. Small pencil → numeric input + save / cancel.
 *  Direct Supabase update; the family_wallets "Admins can update" RLS
 *  policy gates the write. Enforces min = current admin count (can't
 *  lower below what's already provisioned) and max = 5 (defensive; the
 *  DB check is >= 1 only). */
function AdminCapEditor({
  familyWalletId,
  currentCap,
  adminCount,
  onChanged,
}: {
  familyWalletId: string;
  currentCap: number;
  adminCount: number;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(currentCap));
  const [validationError, setValidationError] = useState<string | null>(null);

  // Only the family's admin can view this editor (`canEditCap` in the
  // parent), and by construction there is at least one admin — the caller.
  // So the floor is `adminCount`, not `max(1, adminCount)`.
  const min = adminCount;

  const write = useCallback(
    async (next: number) => {
      const supabase = getSupabaseBrowserClient();
      const { data, error: updateErr } = await supabase
        .from("family_wallets")
        .update({ admin_cap: next })
        .eq("id", familyWalletId)
        // `.select("id").maybeSingle()` is load-bearing: an RLS-silent
        // rejection returns 0 rows without error, and !data is how we
        // distinguish that from success.
        .select("id")
        .maybeSingle();
      if (updateErr) throw new Error(updateErr.message);
      if (!data) throw new Error("Only an admin can change the cap.");
    },
    [familyWalletId],
  );
  const { run: save, pending: saving, error: saveError } = useSupabaseMutation(write);

  const submit = async () => {
    const next = Number.parseInt(draft, 10);
    if (!Number.isFinite(next) || next < min || next > MAX_ADMIN_CAP) {
      setValidationError(`Choose between ${min} and ${MAX_ADMIN_CAP}.`);
      return;
    }
    if (next === currentCap) {
      setEditing(false);
      return;
    }
    setValidationError(null);
    try {
      await save(next);
      setEditing(false);
      onChanged?.();
    } catch {
      // surfaces via saveError
    }
  };
  const error = validationError ?? saveError;

  if (!editing) {
    return (
      <button
        type="button"
        className="sobre-envs-section-cap-edit"
        onClick={() => {
          setDraft(String(currentCap));
          setValidationError(null);
          setEditing(true);
        }}
        aria-label="Change admin cap"
        title="Change admin cap"
      >
        <PencilSimpleIcon size={11} weight="bold" />
        Change
      </button>
    );
  }

  return (
    <span className="sobre-envs-section-cap-editor">
      <input
        type="number"
        min={min}
        max={MAX_ADMIN_CAP}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
        autoFocus
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        aria-label="Save cap"
      >
        <CheckIcon size={12} weight="bold" />
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setValidationError(null);
        }}
        disabled={saving}
        aria-label="Cancel"
      >
        <XIcon size={12} weight="bold" />
      </button>
      {error ? <span className="err">{error}</span> : null}
    </span>
  );
}
