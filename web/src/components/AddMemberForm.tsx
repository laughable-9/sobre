"use client";

import { useState } from "react";

import { useAddMember } from "@/hooks/useAddMember";

export function AddMemberForm({
  userAddress,
  onSuccess,
}: {
  userAddress: string | null;
  onSuccess: () => void;
}) {
  const [memberAddress, setMemberAddress] = useState("");
  const { addMember, pending, error, lastHash } = useAddMember(userAddress);

  if (!userAddress) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = memberAddress.trim();
    if (!trimmed) return;
    try {
      await addMember(trimmed);
      onSuccess();
      setMemberAddress("");
    } catch {
      // error on hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <p className="text-xs" style={{ color: "var(--text-2)" }}>
        Paste the family member&apos;s Stellar address (G…). The contract caps
        the wallet at 2 members; the admin counts as one.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={memberAddress}
          onChange={(e) => setMemberAddress(e.target.value)}
          className="sobre-input flex-1 min-w-[24rem]"
          placeholder="G…"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="sobre-btn sobre-btn-primary"
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          {pending ? "Adding…" : "Add member"}
        </button>
      </div>
      {error ? (
        <p
          className="text-xs break-all"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
      {lastHash ? (
        <p className="text-xs" style={{ color: "var(--sobre-accent)" }}>
          tx: {lastHash.slice(0, 16)}…
        </p>
      ) : null}
    </form>
  );
}
