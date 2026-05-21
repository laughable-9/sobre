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
      // error already on hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={memberAddress}
          onChange={(e) => setMemberAddress(e.target.value)}
          className="flex-1 min-w-[24rem] rounded border px-2 py-1 text-sm font-mono"
          placeholder="G... (Stellar address)"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add member"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only the admin can add members. Max 2 members total (admin counts as one).
      </p>
      {error ? (
        <p className="text-xs text-destructive break-all">{error}</p>
      ) : null}
      {lastHash ? (
        <p className="text-xs text-emerald-600">tx: {lastHash.slice(0, 16)}…</p>
      ) : null}
    </form>
  );
}
