"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  DollarSign,
  Eye,
  Shield,
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
    fil: "Open a Sobre.",
    body:
      "Open a shared wallet from your phone in under 60 seconds. Invite your family with a link.",
  },
  {
    num: 2,
    fil: "Set the split.",
    body:
      "Three envelopes: Groceries, Tuition, Savings. Pick the percentages. ₱10,000 becomes ₱5,000 / ₱3,000 / ₱2,000 automatically.",
  },
  {
    num: 3,
    fil: "Send. Split. Done.",
    body:
      "The moment a deposit lands on Stellar, Sobre splits it across the envelopes. Both sides see it instantly.",
  },
  {
    num: 4,
    fil: "Every peso has a place.",
    body:
      "Set a daily limit. Lock specific envelopes so big spends need admin approval. Savings earns interest while it sits.",
  },
];

const TRUST = [
  {
    icon: <Shield size={18} strokeWidth={2} />,
    title: "Built on Stellar",
    body: "Your wallet is a smart contract on Stellar. No bank in the middle.",
  },
  {
    icon: <Eye size={18} strokeWidth={2} />,
    title: "Verifiable on-chain",
    body: "Every deposit, spend, and approval is a public transaction.",
  },
  {
    icon: <DollarSign size={18} strokeWidth={2} />,
    title: "Fractions of a cent",
    body: "Stellar charges micro-fees per transaction. Sobre adds zero.",
  },
];

const SENDER_POINTS = [
  "See where every peso goes, in real time.",
  "No more panic calls asking for extra money.",
  "Set the split once. Sobre handles it forever.",
  "Sleep better knowing nothing falls through the cracks.",
];

const FAMILY_POINTS = [
  "No fighting over who spent what.",
  "Big purchases need admin approval, so there's no impulse spending.",
  "Real-time visibility into the whole wallet.",
  "Savings grows automatically while you focus on family.",
];

const FAQS = [
  {
    q: "Is Sobre a bank?",
    a: "No. Sobre is a smart contract wallet on the Stellar blockchain. Your balances live on-chain, and the contract is token-agnostic — we use XLM today, with USDC support on the roadmap.",
  },
  {
    q: "What do I need to start?",
    a: "Just a phone. Sobre works on iPhone, Android, and any web browser. No KYC, no minimum deposit.",
  },
  {
    q: "How do I send money in?",
    a: "Send native XLM from any Stellar wallet (we use Freighter for the demo). On-ramp partners like Transak that convert pesos to Stellar tokens are on the roadmap.",
  },
  {
    q: "Can I cash out to pesos?",
    a: "Yes — through off-ramp partners like MoneyGram, you can cash out anywhere in the Philippines.",
  },
  {
    q: "What if the family disagrees?",
    a: "Only the admin can change the envelope split. All transactions are visible to every member. Big spends require approval. Designed to prevent conflict, not create it.",
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

  const connectButton = address ? (
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
      {status === "checking" ? "Checking…" : "Connect"}
    </button>
  );

  return (
    <header className="sobre-nav">
      <div className="sobre-container sobre-nav-inner">
        <Link href="#top" className="sobre-brand">
          <Image
            src="/sobre-logo2.svg"
            alt=""
            width={32}
            height={32}
            priority
          />
          <span className="sobre-brand-name">Sobre</span>
        </Link>
        <nav className="sobre-nav-links">
          <a href="#how" className="sobre-nav-link-text">
            How it works
          </a>
          <a href="#about" className="sobre-nav-link-text">
            About
          </a>
          {connectButton}
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
      <div className="sobre-hero-grid">
        <div className="sobre-hero-content">
          <h1 className="sobre-hero-headline">
            One Sobre.
            <br />
            No matter the{" "}
            <em className="sobre-hero-accent">distance</em>.
          </h1>
          <p className="sobre-hero-subhead">
            The joint account for Filipino families. Money you send home
            auto-splits into envelopes the moment it arrives.
          </p>
          <Link href="/dashboard" className="sobre-hero-cta">
            Open a Sobre
            <ArrowRight size={16} strokeWidth={2.4} />
          </Link>
        </div>
        <div className="sobre-hero-right">
          <video
            className="sobre-hero-loop"
            src="/loop-1.mp4"
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            controlsList="nodownload nofullscreen noremoteplayback"
          />
        </div>
      </div>
    </section>
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
            Money sent home,{" "}
            <em className="sobre-em">but it&apos;s never enough.</em>
          </h2>
          <p className="sobre-lede" style={{ marginTop: 16 }}>
            Years of work abroad. Billions sent home. And yet, most families
            still come up short.
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
            Sending home,{" "}
            <em className="sobre-em">simplified.</em>
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
            Not just a wallet.{" "}
            <em className="sobre-em">A plan for the family.</em>
          </h2>
        </div>

        <FeatureRow>
          <SplitVisual />
          <FeatureCopy
            heading={
              <>
                Decide once.{" "}
                <em className="sobre-em">Sobre handles it forever.</em>
              </>
            }
            body={
              <>
                ₱10,000 in → ₱5,000 Groceries, ₱3,000 Tuition, ₱2,000 Savings.
                No more dividing the money by hand after a long shift.
              </>
            }
          />
        </FeatureRow>

        <FeatureRow reverse>
          <MembersVisual />
          <FeatureCopy
            heading={
              <>
                Set a daily limit. Lock the{" "}
                <em className="sobre-em">important envelopes.</em>
              </>
            }
            body={
              <>
                As admin you can cap each member&apos;s daily spend or require
                approval on specific envelopes like Tuition or Savings.
                Spends that cross the line wait for your sign-off before the
                funds move.
              </>
            }
          />
        </FeatureRow>

        <FeatureRow>
          <SavingsVisual />
          <FeatureCopy
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
  heading,
  body,
}: {
  heading: React.ReactNode;
  body: React.ReactNode;
}) {
  return (
    <div className="sobre-feat">
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
        <PolicyRow
          icon="⏱"
          title="Daily limit per member"
          value="₱ 500"
        />
        <PolicyRow
          icon="🔒"
          title="Tuition needs approval"
          value="Locked"
        />
        <PolicyRow
          icon="🔒"
          title="Savings needs approval"
          value="Locked"
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
            fontSize: 13,
          }}
        >
          Groceries stays open for small day-to-day spends.
        </div>
      </div>
    </div>
  );
}

function PolicyRow({
  icon,
  title,
  value,
}: {
  icon: string;
  title: string;
  value: string;
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
          borderRadius: 10,
          background: "var(--surface-alt)",
          display: "grid",
          placeItems: "center",
          fontSize: 18,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      </div>
      <span
        className="sobre-pill"
        style={{
          background: "#fdf3d8",
          color: "#b88b1c",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {value}
      </span>
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
            For the sender. For the family.{" "}
            <em className="sobre-em">Same wallet.</em>
          </h2>
        </div>

        <div className="sobre-duo">
          <div className="sobre-duo-col mango">
            <div
              className="sobre-eyebrow"
              style={{ color: "var(--primary-hover)" }}
            >
              For the sender
            </div>
            <h3 style={{ marginTop: 10 }}>Send home with zero guesswork.</h3>
            <ul>
              {SENDER_POINTS.map((p, i) => (
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
            Frequently asked questions
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
          <em className="sobre-em">Open the Sobre.</em> Open the plan.
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
                src="/sobre-logo2.svg"
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
