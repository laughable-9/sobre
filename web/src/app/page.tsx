"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  DollarSign,
  Eye,
  GraduationCap,
  Shield,
  ShoppingCart,
  Sprout,
  TrendingUp,
} from "lucide-react";

import { useFreighter } from "@/hooks/useFreighter";
import { WalletMenu } from "@/components/sobre/WalletMenu";

function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

const STATS = [
  {
    num: "$35.6B",
    desc: "yearly remittances from OFWs — yet most families struggle to save.",
  },
  {
    num: ["8", "10"] as const,
    desc: "OFWs return home with no savings after years of working abroad.",
  },
  {
    num: "96%",
    desc: "of remittances are consumed by food and other basic needs.",
  },
  {
    num: ["1", "5"] as const,
    desc: "OFW families run out of money before the next remittance arrives.",
  },
];

const STEPS = [
  {
    num: 1,
    fil: "Buksan ang sobre.",
    body:
      "Open a shared wallet from your phone in under 60 seconds. Invite your family with a link.",
  },
  {
    num: 2,
    fil: "Hatiin ang pera.",
    body:
      "Decide your envelopes: Groceries, Tuition, Savings. Set the split. ₱10,000 becomes ₱5,000 / ₱3,000 / ₱2,000 automatically.",
  },
  {
    num: 3,
    fil: "Padala. Hatian. Tapos.",
    body:
      "The moment your remittance lands on Stellar, Sobre splits it across your envelopes. Both sides see it instantly.",
  },
  {
    num: 4,
    fil: "Bawat piso, may pinupuntahan.",
    body:
      "Each member can only spend from their assigned envelope. Every transaction shows up live. Savings earns interest while it sits.",
  },
];

const TRUST = [
  {
    icon: <Shield size={18} strokeWidth={2} />,
    title: "Token-agnostic by design",
    body:
      "The contract accepts any SEP-41 token at init. We use XLM today on Stellar; USDC and EURC support is one config change away.",
  },
  {
    icon: <Eye size={18} strokeWidth={2} />,
    title: "Verifiable on-chain",
    body:
      "Every deposit, spend, and approval is a public Stellar transaction. Nothing hidden — the ledger is the source of truth.",
  },
  {
    icon: <DollarSign size={18} strokeWidth={2} />,
    title: "Fractions of a cent",
    body:
      "Stellar's network charges micro-fees per transaction. Sobre adds zero on top.",
  },
];

const OFW_POINTS = [
  "See exactly where every peso goes — in real time.",
  "No more panic calls asking for extra money.",
  "Set the split once; let Sobre handle it monthly.",
  "Sleep better knowing nothing falls through the cracks.",
];

const FAMILY_POINTS = [
  "No fighting over who spent what.",
  "Big purchases need a quick approval — prevents impulse buys.",
  <>Real-time visibility, no more <em>&quot;wala na pong pera&quot;</em>.</>,
  "Savings grows automatically while you focus on family.",
];

const FAQS = [
  {
    q: "Is Sobre a bank?",
    a: "No. Sobre is a smart contract wallet on the Stellar blockchain. Your balances live on-chain, and the contract is token-agnostic — we use XLM today, with USDC support on the roadmap.",
  },
  {
    q: "Anong kailangan ko para magsimula?",
    a: "Just a phone. Sobre works on iPhone, Android, and any web browser. No KYC barriers, no minimum deposit.",
  },
  {
    q: "Paano ako magpapadala ng pera?",
    a: "On-ramp partners like Transak (roadmap) will let you send pesos or any currency, auto-converted to Stellar tokens. Today, sending native XLM from your Freighter wallet works end-to-end on testnet.",
  },
  {
    q: "Pwede ko ba i-cash out sa pesos?",
    a: "Yes — through off-ramp partners like MoneyGram, you can cash out anywhere in the Philippines.",
  },
  {
    q: "Ano ang fee?",
    a: "Sobre charges 0% on transfers between family members. Network fees on Stellar are fractions of a cent. On-ramp and off-ramp partners may charge their own fees, fully disclosed up front.",
  },
  {
    q: "Ano kung mag-away ang pamilya?",
    a: "Only the admin (whoever creates the wallet) can change the envelope splits. All transactions are visible. Big spends require approval. Designed to prevent conflict, not create it.",
  },
];

export default function Landing() {
  const [openFaq, setOpenFaq] = useState(0);
  return (
    <>
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <Product />
      <Trust />
      <TwoSides />
      <Faq openFaq={openFaq} setOpenFaq={setOpenFaq} />
      <FinalCTA />
      <Footer />
    </>
  );
}

function Nav() {
  const wallet = useFreighter();
  const { status, address, connect } = wallet;

  return (
    <header className="sobre-nav">
      <div className="sobre-container sobre-nav-inner">
        <Link href="#top" className="sobre-brand">
          <Image
            src="/sobre-logo.svg"
            alt=""
            width={32}
            height={32}
            priority
          />
          <span className="sobre-brand-name">Sobre</span>
        </Link>
        <nav className="sobre-nav-links">
          <a href="#how">How it works</a>
          <a href="#about">About</a>
          {address ? (
            <WalletMenu wallet={wallet} />
          ) : status === "not-installed" ? (
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noreferrer"
              className="sobre-btn-nav sobre-btn-nav-soft"
            >
              Install Freighter
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              className="sobre-btn-nav sobre-btn-nav-soft"
              disabled={status === "checking"}
            >
              {status === "checking" ? "Checking…" : "Connect Wallet"}
            </button>
          )}
          <Link href="/dashboard" className="sobre-btn-nav">
            Open Sobre
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="sobre-hero">
      <div className="sobre-container sobre-hero-grid">
        <div>
          <h1 className="sobre-h1">
            <em className="sobre-em">Isang sobre.</em>
            <br />
            <em className="sobre-em">Isang pamilya.</em>
            <br />
            Magkasama{" "}
            <span style={{ color: "var(--sobre-primary)" }}>kahit malayo</span>.
          </h1>
          <p className="sobre-hero-sub">
            The joint account for OFW families. Your remittance auto-splits
            into envelopes the moment it arrives.
          </p>
          <div className="sobre-hero-cta">
            <Link
              href="/dashboard"
              className="sobre-btn-primary-large"
            >
              Open a Shared Sobre
              <ArrowRight size={16} strokeWidth={2} />
            </Link>
            <a href="#how" className="sobre-btn-ghost-large">
              See how it works
              <ArrowRight size={14} strokeWidth={2} />
            </a>
          </div>
          <div className="sobre-hero-trust">
            Built on Stellar &nbsp;·&nbsp; Token-agnostic &nbsp;·&nbsp; No
            hidden fees
          </div>
        </div>

        <PhoneMock />
      </div>
    </section>
  );
}

function PhoneMock() {
  return (
    <div className="sobre-phone-stage">
      <div className="sobre-float-tag">
        <div className="splash">
          <ArrowRight
            size={14}
            strokeWidth={2}
            style={{ transform: "rotate(90deg)" }}
          />
        </div>
        <div>
          <b>Remittance landed</b>
          <span className="sub">+ ₱ 10,000.00 · auto-split</span>
        </div>
      </div>
      <div className="sobre-float-tag bottom">
        <div
          className="splash"
          style={{
            background: "#fbe7d2",
            color: "var(--primary-hover)",
          }}
        >
          <ShoppingCart size={14} strokeWidth={2} />
        </div>
        <div>
          <b>Maria spent ₱ 350</b>
          <span className="sub">Groceries · just now</span>
        </div>
      </div>

      <div className="sobre-phone">
        <div className="sobre-phone-screen">
          <div className="sobre-phone-top">
            <div className="wallet-name">Pagunsan Family</div>
            <div className="avatar">MP</div>
          </div>

          <div className="sobre-phone-balance">
            <div className="label">Total balance</div>
            <div className="amt tabular">
              ₱ 24,891
              <span style={{ fontSize: 24, color: "var(--text-2)" }}>.40</span>
            </div>
            <div className="usdc tabular">≈ 1,556 XLM</div>
          </div>

          <div className="sobre-env-stack">
            <PhoneEnvelope
              icon={<ShoppingCart size={16} strokeWidth={1.8} />}
              name="Groceries"
              amount="₱ 5,234.50"
              fill={62}
            />
            <PhoneEnvelope
              icon={<GraduationCap size={16} strokeWidth={1.8} />}
              name="Tuition"
              amount="₱ 7,800.00"
              fill={84}
            />
            <PhoneEnvelope
              icon={<Sprout size={16} strokeWidth={1.8} />}
              name={
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  Savings{" "}
                  <span
                    className="sobre-pill sobre-pill-soft-green"
                    style={{ padding: "1px 6px", fontSize: 10 }}
                  >
                    4.5% APY
                  </span>
                </span>
              }
              amount="₱ 11,856.90"
              fill={100}
              green
            />
          </div>

          <div className="sobre-phone-toast">
            <span className="dot" />
            Remittance + ₱10,000 auto-split across 3 envelopes
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneEnvelope({
  icon,
  name,
  amount,
  fill,
  green,
}: {
  icon: React.ReactNode;
  name: React.ReactNode;
  amount: string;
  fill: number;
  green?: boolean;
}) {
  return (
    <div className="sobre-env-mini">
      <div className={`sobre-env-icon${green ? " green" : ""}`}>{icon}</div>
      <div className="meta">
        <div className="name">{name}</div>
        <div className="amt tabular">{amount}</div>
        <div className={`bar${green ? " green" : ""}`}>
          <span style={{ width: `${fill}%` }} />
        </div>
      </div>
    </div>
  );
}

function Problem() {
  return (
    <section
      className="sobre-section"
      style={{ background: "var(--surface-alt)" }}
    >
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">The reality</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Ang totoo:{" "}
            <em className="sobre-em">ang remittance hindi sapat.</em>
          </h2>
          <p className="sobre-lede" style={{ marginTop: 16 }}>
            Years of work abroad. Billions in money sent home. And yet, most
            families still come up short.
          </p>
        </div>

        <div className="sobre-stat-grid">
          {STATS.map((s, i) => (
            <div key={i} className="sobre-stat-card">
              <div className="sobre-stat-num">
                {Array.isArray(s.num) ? (
                  <>
                    {s.num[0]}
                    <span
                      style={{
                        fontSize: "0.45em",
                        color: "var(--text-2)",
                      }}
                    >
                      &nbsp;in&nbsp;
                    </span>
                    {s.num[1]}
                  </>
                ) : (
                  s.num
                )}
              </div>
              <div className="sobre-stat-desc">{s.desc}</div>
            </div>
          ))}
        </div>
        <div className="sobre-sources">
          Sources: BSP, GMA News, Rappler, Ateneo Policy Brief 2020
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="sobre-section">
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">How it works</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Paano gumagana
          </h2>
          <p className="sobre-lede" style={{ marginTop: 16 }}>
            Four steps. No banks. No middlemen. Just your family on the same
            page.
          </p>
        </div>

        <div className="sobre-steps">
          {STEPS.map((s) => (
            <div key={s.num} className="sobre-step">
              <div className="sobre-step-num">{s.num}</div>
              <div className="sobre-step-fil">{s.fil}</div>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Product() {
  return (
    <section
      className="sobre-section"
      style={{ background: "var(--surface-alt)" }}
    >
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">The product</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Hindi lang wallet.{" "}
            <em className="sobre-em">Plano para sa pamilya.</em>
          </h2>
        </div>

        <FeatureRow>
          <SplitVisual />
          <FeatureCopy
            tag="Auto-split on arrival"
            heading={
              <>
                Decide once.{" "}
                <em className="sobre-em">Sobre handles it forever.</em>
              </>
            }
            body={
              <>
                ₱10,000 in → ₱5,000 Groceries, ₱3,000 Tuition, ₱2,000 Savings.{" "}
                <em>Walang nakakalimutan.</em> No more dividing the padala by
                hand after a long shift abroad.
              </>
            }
          />
        </FeatureRow>

        <FeatureRow reverse>
          <MembersVisual />
          <FeatureCopy
            tag="Role-based envelopes"
            heading={
              <>
                Everyone only spends from their{" "}
                <em className="sobre-em">own envelope.</em>
              </>
            }
            body={
              <>
                Your wife handles groceries. Your parents handle utilities.
                Each family member can only access their assigned envelope —{" "}
                <em>no more &quot;nasaan na ang pera?&quot;</em>
              </>
            }
          />
        </FeatureRow>

        <FeatureRow>
          <SavingsVisual />
          <FeatureCopy
            tag="Savings that grow"
            heading={
              <>
                Money in Savings <em className="sobre-em">actually earns.</em>
              </>
            }
            body={
              <>
                Money in your Savings envelope earns competitive yield from
                regulated dollar-backed reserves. Better than letting it sit
                in a regular bank account losing value to inflation.
              </>
            }
          />
        </FeatureRow>
      </div>
    </section>
  );
}

function FeatureRow({
  children,
  reverse,
}: {
  children: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className={`sobre-feat-row${reverse ? " reverse" : ""}`}>
      {children}
    </div>
  );
}

function FeatureCopy({
  tag,
  heading,
  body,
}: {
  tag: string;
  heading: React.ReactNode;
  body: React.ReactNode;
}) {
  return (
    <div className="sobre-feat">
      <div className="sobre-feat-tag">
        <Check size={14} strokeWidth={2} />
        {tag}
      </div>
      <h2>{heading}</h2>
      <p>{body}</p>
    </div>
  );
}

function SplitVisual() {
  return (
    <div className="sobre-feat-visual">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            flex: 1,
            background: "#fbe7d2",
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--primary-hover)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Incoming
          </div>
          <div
            className="tabular"
            style={{
              fontFamily: "var(--serif)",
              fontSize: 28,
              fontWeight: 600,
              color: "var(--primary-hover)",
              marginTop: 4,
            }}
          >
            ₱ 10,000
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              marginTop: 2,
            }}
          >
            625 XLM · from Riyadh
          </div>
        </div>
        <ArrowRight size={36} strokeWidth={1.5} color="#A89888" />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginTop: 18,
        }}
      >
        <SplitTile label="Groceries · 50%" amount="₱ 5,000" fill={50} />
        <SplitTile label="Tuition · 30%" amount="₱ 3,000" fill={30} />
        <SplitTile label="Savings · 20%" amount="₱ 2,000" fill={20} green />
      </div>
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px dashed var(--border-strong)",
          fontSize: 12,
          color: "var(--text-2)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--sobre-accent)",
          }}
        />
        Settled on Stellar in 4.7 seconds · fee ₱0.04
      </div>
    </div>
  );
}

function SplitTile({
  label,
  amount,
  fill,
  green,
}: {
  label: string;
  amount: string;
  fill: number;
  green?: boolean;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-2)" }}>{label}</div>
      <div
        className="tabular"
        style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          fontWeight: 600,
          marginTop: 6,
        }}
      >
        {amount}
      </div>
      <div
        style={{
          height: 4,
          background: "var(--surface-alt)",
          borderRadius: 999,
          marginTop: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${fill}%`,
            height: "100%",
            background: green ? "var(--sobre-accent)" : "var(--sobre-primary)",
          }}
        />
      </div>
    </div>
  );
}

function MembersVisual() {
  return (
    <div className="sobre-feat-visual">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <MemberRow
          initials="MA"
          bg="#fbe7d2"
          fg="var(--primary-hover)"
          name="Maria · wife"
          access="Access: Groceries"
          pill="₱ 5,234.50"
        />
        <MemberRow
          initials="PE"
          bg="var(--accent-soft)"
          fg="var(--sobre-accent)"
          name="Kuya Pedro · brother"
          access="Access: Utilities"
          pill="₱ 1,840.00"
        />
        <MemberRow
          initials="LN"
          bg="var(--surface-alt)"
          fg="var(--text-1)"
          name="Lola Norma · mother"
          access="Access: Tuition · view only"
          pill="₱ 7,800.00"
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "#fff",
            border: "1.5px dashed var(--border-strong)",
            borderRadius: 10,
            padding: 14,
            color: "var(--text-3)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1.5px dashed var(--border-strong)",
              display: "grid",
              placeItems: "center",
            }}
          >
            +
          </div>
          <div style={{ flex: 1, fontSize: 13 }}>
            Invite another family member
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  initials,
  bg,
  fg,
  name,
  access,
  pill,
}: {
  initials: string;
  bg: string;
  fg: string;
  name: string;
  access: string;
  pill: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: bg,
          color: fg,
          display: "grid",
          placeItems: "center",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>{access}</div>
      </div>
      <span className="sobre-pill sobre-pill-cream tabular">{pill}</span>
    </div>
  );
}

function SavingsVisual() {
  return (
    <div className="sobre-feat-visual">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            Savings envelope
          </div>
          <div
            className="tabular"
            style={{
              fontFamily: "var(--serif)",
              fontSize: 34,
              fontWeight: 600,
              color: "var(--sobre-accent)",
              marginTop: 4,
            }}
          >
            ₱ 11,856.90
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
741 XLM
          </div>
        </div>
        <span
          className="sobre-pill sobre-pill-soft-green"
          style={{ padding: "6px 12px", fontSize: 13 }}
        >
          <TrendingUp size={12} strokeWidth={2.5} />
          Est. 4.5% APY
        </span>
      </div>
      <svg
        viewBox="0 0 400 120"
        style={{ marginTop: 24, width: "100%", height: 140 }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2E6B4C" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2E6B4C" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,100 L40,92 L80,86 L120,80 L160,70 L200,66 L240,58 L280,50 L320,38 L360,28 L400,18 L400,120 L0,120 Z"
          fill="url(#sparkfill)"
        />
        <path
          d="M0,100 L40,92 L80,86 L120,80 L160,70 L200,66 L240,58 L280,50 L320,38 L360,28 L400,18"
          fill="none"
          stroke="#2E6B4C"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-3)",
          marginTop: 4,
        }}
      >
        <span>Jan</span>
        <span>Mar</span>
        <span>May</span>
        <span>Jul</span>
        <span>Sep</span>
        <span>Nov</span>
      </div>
    </div>
  );
}

function Trust() {
  return (
    <section className="sobre-section">
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">Why this works</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Built on infrastructure you can audit.
          </h2>
          <p className="sobre-lede" style={{ marginTop: 16 }}>
            Sobre is built on Stellar — the same chain used by MoneyGram for
            cross-border payouts. The contract is token-agnostic, so the same
            wallet works for XLM today and stablecoins on the roadmap. Every
            transaction is public and verifiable.
          </p>
        </div>

        <div className="sobre-trust-grid">
          {TRUST.map((t) => (
            <div key={t.title} className="sobre-trust-card">
              <div className="icon">{t.icon}</div>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TwoSides() {
  return (
    <section
      className="sobre-section"
      style={{ background: "var(--surface-alt)" }}
    >
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">Two sides, one wallet</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Para sa OFW. Para sa pamilya.{" "}
            <em className="sobre-em">Pareho.</em>
          </h2>
        </div>

        <div className="sobre-duo">
          <div className="sobre-duo-col mango">
            <div
              className="sobre-eyebrow"
              style={{ color: "var(--primary-hover)" }}
            >
              For the OFW abroad
            </div>
            <h3 style={{ marginTop: 10 }}>Send home with zero guesswork.</h3>
            <ul>
              {OFW_POINTS.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="sobre-duo-col green">
            <div className="sobre-eyebrow">For the family at home</div>
            <h3 style={{ marginTop: 10 }}>Each person has their own envelope.</h3>
            <ul>
              {FAMILY_POINTS.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq({
  openFaq,
  setOpenFaq,
}: {
  openFaq: number;
  setOpenFaq: (i: number) => void;
}) {
  return (
    <section className="sobre-section" id="about">
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">FAQ</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Mga tanong na <em className="sobre-em">madalas itanong.</em>
          </h2>
        </div>
        <div className="sobre-faq">
          {FAQS.map((item, i) => (
            <div
              key={item.q}
              className={`sobre-faq-item${openFaq === i ? " open" : ""}`}
              id={item.q.toLowerCase().includes("fee") ? "pricing" : undefined}
            >
              <button
                type="button"
                className="sobre-faq-q"
                onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
              >
                <span>{item.q}</span>
                <ChevronDown
                  size={20}
                  strokeWidth={2}
                  className="chev"
                />
              </button>
              <div className="sobre-faq-a">
                <div className="sobre-faq-a-inner">{item.a}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="sobre-final-cta">
      <div className="sobre-container">
        <h2>
          <em className="sobre-em">Buksan ang sobre.</em> Buksan ang plano.
        </h2>
        <p className="lede sobre-lede">
          Open a wallet in 60 seconds. Invite your family. Send your first
          remittance.
        </p>
        <Link
          href="/dashboard"
          className="sobre-btn-cream"
          style={{
            fontSize: 16,
            padding: "16px 28px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Start with Sobre, free
          <ArrowRight size={16} strokeWidth={2} />
        </Link>
        <div className="fine">
          No credit card. No KYC barriers. Demo available now.
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="sobre-footer">
      <div className="sobre-container">
        <div className="sobre-footer-grid">
          <div>
            <div className="sobre-brand">
              <Image
                src="/sobre-logo.svg"
                alt=""
                width={32}
                height={32}
              />
              <span className="sobre-brand-name">Sobre</span>
            </div>
            <p
              style={{
                marginTop: 16,
                fontSize: 14,
                maxWidth: "32ch",
                color: "var(--text-2)",
              }}
            >
              A joint account for families living worlds apart. Made for OFWs,
              built on Stellar.
            </p>
          </div>
          <div className="sobre-footer-col">
            <h4>Product</h4>
            <ul>
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <a href="#about">FAQ</a>
              </li>
              <li>
                <Link href="/dashboard">Open Wallet</Link>
              </li>
            </ul>
          </div>
          <div className="sobre-footer-col">
            <h4>Legal</h4>
            <ul>
              <li>
                <a href="#">Privacy</a>
              </li>
              <li>
                <a href="#">Terms</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="sobre-footer-bottom">
          <div>© 2026 Sobre. Built for Stellar Philippines Hackathon.</div>
          <div style={{ display: "flex", gap: 14, color: "var(--text-3)" }}>
            <a
              href="https://github.com/laughable-9/sobre"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <GithubMark size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
