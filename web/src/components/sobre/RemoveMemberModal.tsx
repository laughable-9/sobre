"use client";

import { AlertTriangle } from "lucide-react";

import type { Member } from "@/hooks/useWalletState";
import { shortenAddress } from "@/lib/format";
import { backdropClose } from "@/lib/ui";

export function RemoveMemberModal({
  member,
  pending,
  walletName,
  onClose,
  onConfirm,
}: {
  member: Member;
  pending: boolean;
  walletName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const label = member.name || shortenAddress(member.address);
  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div className="sobre-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="grid place-items-center"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "#fbe4e0",
              color: "#7a2a1d",
            }}
          >
            <AlertTriangle size={20} strokeWidth={2.2} />
          </div>
          <h2 style={{ margin: 0 }}>Remove {label}?</h2>
        </div>

        <p className="sub">
          They&apos;ll lose access to <em>{walletName}</em> immediately and the
          card disappears from their dashboard. The wallet keeps all funds —
          this only changes who can see and spend from it.
        </p>

        <div
          className="rounded-[10px] p-3 flex items-center gap-3 mb-5"
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="grid place-items-center shrink-0"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              fontSize: 20,
            }}
          >
            {member.emoji || "👤"}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-[14px] font-medium truncate"
              style={{ color: "var(--text-1)" }}
            >
              {member.name || "Unnamed member"}
            </div>
            <div
              className="text-[11px] font-mono truncate"
              style={{ color: "var(--text-3)" }}
            >
              {shortenAddress(member.address)}
            </div>
          </div>
        </div>

        <div className="sobre-modal-actions">
          <button
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="sobre-btn sobre-btn-danger"
            onClick={onConfirm}
            disabled={pending}
            style={pending ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            {pending ? "Removing…" : "Remove member"}
          </button>
        </div>
      </div>
    </div>
  );
}
