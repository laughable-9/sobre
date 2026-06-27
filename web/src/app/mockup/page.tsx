import Link from "next/link";
import { ArrowRight } from "lucide-react";

const MOCKUPS = [
  {
    href: "/mockup/setup",
    eyebrow: "1 · Set Up Together",
    title: "Open a Sobre",
    body: "Creator adds a co-Admin and a Recipient. Two roles, one shared wallet, ready in under a minute.",
  },
  {
    href: "/mockup/fund",
    eyebrow: "2 · Fund the Wallet",
    title: "Cash in via the on-ramp",
    body: "Money enters the wallet from any corridor. PHP, USDC, bank, card, e-wallet.",
  },
  {
    href: "/mockup/split",
    eyebrow: "3 · Split Fires Automatically",
    title: "Watch the envelopes",
    body: "Atomic split across envelopes per the agreed percentages. Everyone sees the same picture.",
  },
  {
    href: "/mockup/cashout",
    eyebrow: "4 · Cash-out",
    title: "Withdraw to a saved destination",
    body: "Money leaves the wallet to a bank account or e-wallet. Identity verified before it leaves.",
  },
  {
    href: "/mockup/sub-sobre",
    eyebrow: "5 · Sub-accounts",
    title: "Supplementary wallets for kids",
    body: "Admin tops up Junior from any envelope. Junior only sees his own balance + spend history. Admin can lock him out at any time, like freezing a supplementary card.",
  },
];

export default function MockupIndex() {
  return (
    <div style={{ padding: "32px 22px 80px" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--sobre-primary)",
        }}
      >
        Pitch deck mockups
      </div>
      <h1
        style={{
          fontFamily: "var(--serif)",
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          margin: "10px 0 12px",
          lineHeight: 1.2,
        }}
      >
        Four flows. One household plan.
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--text-2)",
          lineHeight: 1.55,
          marginBottom: 28,
        }}
      >
        Each link opens one of the four pitch moments. Designed for Mobile L
        (425px) so the demo feels like the actual app.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {MOCKUPS.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              boxShadow: "var(--shadow-sm)",
              color: "inherit",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--sobre-primary)",
              }}
            >
              {m.eyebrow}
            </div>
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              {m.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-2)",
                lineHeight: 1.5,
              }}
            >
              {m.body}
            </div>
            <div
              style={{
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--sobre-primary)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Open mockup
              <ArrowRight size={14} strokeWidth={2.5} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
