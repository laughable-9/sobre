"use client";

import Link from "next/link";
import { ArrowRight, Crown, User, Wallet } from "lucide-react";

/**
 * Sub-sobre mockup entry. Three role views to flip between so reviewers can
 * see what each role sees side by side. Modelled after supplementary cards:
 * admin = primary, member = co-cardholder (existing pending-request flow),
 * sub-account = supplementary card holder (only sees their own balance).
 *
 * This is a STANDALONE mockup — no real contract calls, no real Supabase
 * reads. Visual evaluation only.
 */
export default function SubSobreMockupIndex() {
  return (
    <div style={{ padding: "28px 22px 48px", maxWidth: 520, margin: "0 auto" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--sobre-primary)",
        }}
      >
        Sub-account · pitch deck mockup
      </div>
      <h1
        style={{
          fontFamily: "var(--serif)",
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          margin: "10px 0 8px",
          lineHeight: 1.2,
        }}
      >
        Three roles, one Sobre.
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--text-2)",
          margin: "0 0 22px",
          lineHeight: 1.5,
        }}
      >
        Sobre families have three roles, modelled after primary +
        supplementary card holders. Pick a view to see what that role sees on
        the dashboard.
      </p>

      <RoleLink
        href="/mockup/sub-sobre/admin"
        eyebrow="Primary cardholder"
        title="Admin · Daddy"
        body="Sees the whole Sobre, all envelopes, and every sub-account. Picks which envelope to top up Junior from. Can lock his sub-account at any time."
        icon={<Crown size={20} strokeWidth={2} />}
      />
      <RoleLink
        href="/dashboard"
        eyebrow="Co-cardholder"
        title="Member · Mommy"
        body="Sees the whole Sobre and all envelopes. Spends through the existing pending-request flow that needs admin approval over the threshold."
        icon={<User size={20} strokeWidth={2} />}
        external
      />
      <RoleLink
        href="/mockup/sub-sobre/subaccount"
        eyebrow="Supplementary card"
        title="Sub-account · Junior"
        body="Only sees his own balance + spend history. No envelope visibility. Can cash out his balance to his bank. Admin can freeze him any time."
        icon={<Wallet size={20} strokeWidth={2} />}
      />
    </div>
  );
}

function RoleLink({
  href,
  eyebrow,
  title,
  body,
  icon,
  external,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        marginBottom: 14,
        padding: "16px 18px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--accent-soft)",
            color: "var(--sobre-accent)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 17,
              fontWeight: 600,
              margin: "3px 0 6px",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {title}
            <ArrowRight
              size={14}
              strokeWidth={2.4}
              style={{ color: "var(--text-3)" }}
            />
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
            {body}
          </div>
          {external ? (
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-3)",
                marginTop: 8,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              ↗ opens real dashboard (no mock)
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
