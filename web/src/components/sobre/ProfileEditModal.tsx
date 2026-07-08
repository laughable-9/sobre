"use client";

import { useState } from "react";

import { EmojiPicker, SOBRE_EMOJIS } from "@/components/sobre/EmojiPicker";
import { setProfile, type UserProfile } from "@/lib/profile";
import { backdropClose } from "@/lib/ui";

export function ProfileEditModal({
  address,
  current,
  onClose,
  onSaved,
}: {
  address: string;
  current: UserProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [emoji, setEmoji] = useState<string>(
    current?.emoji ?? SOBRE_EMOJIS[0],
  );
  const valid = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setProfile(address, { name: name.trim(), emoji });
    onSaved();
  };

  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <form
        className="sobre-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Edit your profile</h2>
        <p className="sub">
          Sobre uses this name and icon as defaults when you open or join a
          wallet. Doesn&apos;t change Sobres you&apos;re already a member of.
        </p>

        <div className="sobre-input-group">
          <label htmlFor="profile-edit-name">Your name</label>
          <input
            id="profile-edit-name"
            className="sobre-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            autoFocus
          />
        </div>

        <div className="sobre-input-group">
          <label>Your icon</label>
          <EmojiPicker value={emoji} onChange={setEmoji} />
        </div>

        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="sobre-btn sobre-btn-primary"
            disabled={!valid}
            style={!valid ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
