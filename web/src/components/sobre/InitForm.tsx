"use client";

import { useState } from "react";

import { useInit } from "@/hooks/useInit";
import { EmojiPicker, SOBRE_EMOJIS } from "@/components/sobre/EmojiPicker";

export function InitForm({
  userAddress,
  onSuccess,
}: {
  userAddress: string;
  onSuccess: () => void;
}) {
  const [walletName, setWalletName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [emoji, setEmoji] = useState<string>(SOBRE_EMOJIS[0]);
  const { init, pending, error } = useInit(userAddress);

  const valid = walletName.trim().length > 0 && adminName.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await init({
        walletName: walletName.trim(),
        adminName: adminName.trim(),
        adminEmoji: emoji,
      });
      onSuccess();
    } catch {
      // error on hook
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="text-left space-y-4 mt-6"
      style={{ maxWidth: 360, margin: "24px auto 0" }}
    >
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
        <label htmlFor="admin-name">Your name</label>
        <input
          id="admin-name"
          className="sobre-input"
          type="text"
          placeholder="Juan Dela Cruz"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          disabled={pending}
          maxLength={32}
        />
      </div>
      <div className="sobre-input-group">
        <label>Your emoji</label>
        <EmojiPicker value={emoji} onChange={setEmoji} disabled={pending} />
      </div>
      {error ? (
        <p className="text-xs break-all" style={{ color: "var(--sobre-danger)" }}>
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
          ? "Initializing…"
          : "Open the wallet (50 / 30 / 20)"}
      </button>
    </form>
  );
}
