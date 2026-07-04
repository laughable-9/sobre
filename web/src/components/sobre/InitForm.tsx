"use client";

import { useState } from "react";

import { useCreateSobre } from "@/hooks/useCreateSobre";
import { SOBRE_EMOJIS } from "@/components/sobre/EmojiPicker";
import {
  DEFAULT_ENVELOPE_NAMES,
  EnvelopeNamesEditor,
  isValidEnvelopeNames,
  lockSavings,
  type EnvelopeNames,
} from "@/components/sobre/EnvelopeNamesEditor";
import {
  SplitEditor,
  isValidSplit,
  type Split,
} from "@/components/sobre/SplitEditor";
import { getProfile } from "@/lib/profile";

export function InitForm({
  userAddress,
  onSuccess,
}: {
  userAddress: string;
  /** Called with the freshly-deployed Sobre's contract address. */
  onSuccess: (contractId: string) => void;
}) {
  // The user has already set their name + icon during the first-connect
  // profile setup; reuse those silently so this form only asks for the one
  // thing that's per-Sobre — the wallet name.
  const profile = getProfile(userAddress);
  const adminName = profile?.name ?? "";
  const adminEmoji = profile?.emoji ?? SOBRE_EMOJIS[0];

  const [walletName, setWalletName] = useState("");
  const [envelopeNames, setEnvelopeNames] = useState<EnvelopeNames>(
    DEFAULT_ENVELOPE_NAMES,
  );
  const [split, setSplit] = useState<Split>([50, 30, 20]);
  const { createSobre, pending, error } = useCreateSobre(userAddress);

  const valid =
    walletName.trim().length > 0 &&
    adminName.length > 0 &&
    isValidEnvelopeNames(envelopeNames) &&
    isValidSplit(split);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      const trimmed = lockSavings(
        envelopeNames.map((n) => n.trim()) as EnvelopeNames,
      );
      const newContractId = await createSobre({
        walletName: walletName.trim(),
        adminName,
        adminEmoji,
        percents: split,
        envelopeNames: trimmed,
      });
      onSuccess(newContractId);
    } catch {
      // error on hook
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="text-left space-y-4 mt-6 w-full"
    >
      {profile ? (
        <div
          className="rounded-[10px] p-3 flex items-center gap-3"
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="grid place-items-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              fontSize: 20,
            }}
          >
            {adminEmoji}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-[11px] uppercase tracking-wider"
              style={{ color: "var(--text-3)", fontWeight: 600 }}
            >
              You&apos;ll join as
            </div>
            <div
              className="text-[14px] font-medium truncate"
              style={{ color: "var(--text-1)" }}
            >
              {adminName}
            </div>
          </div>
        </div>
      ) : null}

      <div className="sobre-input-group">
        <label htmlFor="wallet-name">Sobre name</label>
        <input
          id="wallet-name"
          className="sobre-input"
          type="text"
          placeholder="My Family"
          value={walletName}
          onChange={(e) => setWalletName(e.target.value)}
          disabled={pending}
          maxLength={40}
          autoFocus
        />
      </div>

      <div className="sobre-input-group">
        <label>Envelope names</label>
        <p
          className="text-[12px] -mt-1 mb-3"
          style={{ color: "var(--text-3)" }}
        >
          What you call each envelope (e.g., Rent, School, Vacation).
        </p>
        <EnvelopeNamesEditor
          value={envelopeNames}
          onChange={setEnvelopeNames}
          disabled={pending}
        />
      </div>

      <div className="sobre-input-group">
        <label>Envelope split</label>
        <p
          className="text-[12px] -mt-1 mb-3"
          style={{ color: "var(--text-3)" }}
        >
          How each deposit gets distributed. You can change this later.
        </p>
        <SplitEditor
          value={split}
          onChange={setSplit}
          disabled={pending}
          labels={envelopeNames}
        />
      </div>

      {error ? (
        <p
          className="text-xs break-all"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!valid || pending}
        className="sobre-btn sobre-btn-primary w-full justify-center"
        style={{
          padding: "14px 22px",
          fontSize: 15,
          opacity: !valid || pending ? 0.5 : 1,
          cursor: !valid || pending ? "not-allowed" : "pointer",
        }}
      >
        {pending
          ? "Opening your Sobre…"
          : `Open this Sobre (${split[0]} / ${split[1]} / ${split[2]})`}
      </button>
    </form>
  );
}
