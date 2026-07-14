"use client";

import { useState } from "react";
import Image from "next/image";

import { LOGO_SRC } from "@/lib/config";
import { setProfile } from "@/lib/profile";

export function ProfileSetupScreen({
  address,
  defaultName,
  onDone,
}: {
  address: string;
  /** Optional pre-fill (e.g. the user's Google display name). */
  defaultName?: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(defaultName ?? "");
  const valid = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setProfile(address, { name: name.trim() });
    onDone();
  };

  return (
    <main className="flex-1 grid place-items-center px-6 py-12">
      <form
        onSubmit={handleSubmit}
        className="w-full"
        style={{ maxWidth: 440 }}
      >
        <div className="text-center mb-7">
          <Image
            src={LOGO_SRC}
            alt=""
            width={56}
            height={56}
            priority
            className="mx-auto"
          />
          <h1
            className="font-serif mt-5 mb-3"
            style={{ fontSize: 32, fontWeight: 600 }}
          >
            What should we call you?
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-2)" }}>
            Pick a name. We&apos;ll use it by default whenever you open or
            join a Sobre.
          </p>
        </div>

        <div className="sobre-input-group">
          <label htmlFor="profile-name">Your name</label>
          <input
            id="profile-name"
            className="sobre-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="sobre-btn sobre-btn-primary w-full justify-center mt-4"
          style={{
            padding: "14px 22px",
            fontSize: 15,
            opacity: !valid ? 0.5 : 1,
            cursor: !valid ? "not-allowed" : "pointer",
          }}
        >
          Save profile
        </button>

        <p
          className="text-[12px] text-center mt-3"
          style={{ color: "var(--text-3)" }}
        >
          You can change this later inside any Sobre you open.
        </p>
      </form>
    </main>
  );
}
