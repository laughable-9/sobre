"use client";

import { ArrowRight, Mail, Sparkles } from "lucide-react";

export function WalletChooser({
  onNew,
  onJoin,
  canCreate,
  canJoin,
}: {
  onNew: () => void;
  onJoin: () => void;
  /** False when an admin already initialized this Sobre. */
  canCreate: boolean;
  /** False when no Sobre has been opened yet on this contract. */
  canJoin: boolean;
}) {
  return (
    <main className="flex-1 grid place-items-center px-6 py-12">
      <div className="text-center w-full" style={{ maxWidth: 720 }}>
        <h1 className="font-serif text-[36px] font-semibold leading-[1.1]">
          What brings you here?
        </h1>
        <p
          className="text-[16px] mt-3 mb-8"
          style={{ color: "var(--text-2)" }}
        >
          Open a fresh Sobre for your family, or accept an invite to one
          someone already opened.
        </p>

        <div
          className="grid gap-5 text-left"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
          }}
        >
          <ChooserCard
            onClick={onNew}
            disabled={!canCreate}
            disabledReason={
              !canCreate
                ? "This Sobre has already been opened. Use an invite link to join."
                : undefined
            }
            icon={<Sparkles size={20} strokeWidth={2} />}
            title="Open a new Sobre"
            body="Become the admin. Name the Sobre, name yourself, pick an emoji. Your family joins via an invite link."
            cta="Start fresh"
            tone="mango"
          />
          <ChooserCard
            onClick={onJoin}
            disabled={!canJoin}
            disabledReason={
              !canJoin
                ? "Nothing to join yet. Open a new Sobre first, or wait for an invite link."
                : undefined
            }
            icon={<Mail size={20} strokeWidth={2} />}
            title="Join a Sobre"
            body="Have an invite link from your family? Paste it here and we'll walk you through accepting it."
            cta="Paste invite link"
            tone="green"
          />
        </div>
      </div>
    </main>
  );
}

function ChooserCard({
  onClick,
  disabled,
  disabledReason,
  icon,
  title,
  body,
  cta,
  tone,
}: {
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  tone: "mango" | "green";
}) {
  const tonePalette =
    tone === "mango"
      ? {
          iconBg: "#fbe7d2",
          iconFg: "var(--primary-hover)",
        }
      : {
          iconBg: "var(--accent-soft)",
          iconFg: "var(--sobre-accent)",
        };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 28,
        boxShadow: "var(--shadow-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "transform .15s ease, box-shadow .15s ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "var(--shadow-md)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
      }}
    >
      <div
        className="grid place-items-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: tonePalette.iconBg,
          color: tonePalette.iconFg,
          marginBottom: 16,
        }}
      >
        {icon}
      </div>
      <h2
        className="font-serif"
        style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: "var(--text-2)",
          marginBottom: 20,
        }}
      >
        {body}
      </p>
      {disabled && disabledReason ? (
        <div
          className="text-[12px]"
          style={{ color: "var(--text-3)", fontStyle: "italic" }}
        >
          {disabledReason}
        </div>
      ) : (
        <div
          className="inline-flex items-center gap-1.5 text-[14px] font-medium"
          style={{ color: "var(--sobre-primary)" }}
        >
          {cta}
          <ArrowRight size={14} strokeWidth={2.5} />
        </div>
      )}
    </button>
  );
}
