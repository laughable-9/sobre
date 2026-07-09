"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  CaretDownIcon,
  ClockIcon,
  CurrencyDollarIcon,
  EyeIcon,
  LockIcon,
  ShieldIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";

import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { PHP_PER_USDC, STROOPS_PER_USDC } from "@/lib/config";
import { SiteHeader } from "@/components/sobre/SiteHeader";
import { WalletMenu } from "@/components/sobre/WalletMenu";
import { Reveal } from "@/components/sobre/Reveal";
import { BalanceHero } from "@/components/sobre/BalanceHero";
import { EnvelopeSplitCard } from "@/components/sobre/EnvelopeSplitCard";
import { useEnvelopeTransition } from "@/hooks/useEnvelopeTransition";

/**
 * Sample household state for the landing page's product preview — ₱10,000
 * in, split 50/30/20. Feeds the real dashboard components (BalanceHero,
 * EnvelopeSplitCard) so the marketing preview always matches the actual
 * in-app design, not a hand-rolled lookalike.
 */
const PREVIEW_STATE: WalletState = {
  admin: "",
  payment_token: "",
  wallet_name: "Sample family",
  envelope_names: [],
  percents: [50, 30, 20],
  members: [],
  balances: [5000, 3000, 2000].map((php) =>
    BigInt(Math.round((php / PHP_PER_USDC) * STROOPS_PER_USDC)),
  ),
  subaccounts: [],
  policy: {
    requireAllSigs: false,
    dailyLimit: null,
    perTxThreshold: null,
    protectedEnvelopes: [],
  },
  savings_lock_all_admins: false,
  admin_count: 1,
};

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
    desc: "yearly remittances from OFWs, yet most families struggle to save.",
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
    icon: <ShieldIcon weight="fill" size={18} />,
    title: "Built on Stellar",
    body: "Your wallet is a smart contract on Stellar. No bank in the middle.",
  },
  {
    icon: <EyeIcon weight="fill" size={18} />,
    title: "Verifiable on-chain",
    body: "Every deposit, spend, and approval is a public transaction.",
  },
  {
    icon: <CurrencyDollarIcon weight="bold" size={18} />,
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
    a: "No. Sobre is a smart contract wallet on the Stellar blockchain. Your balances live on-chain in XLM, with USDC support on the roadmap. The contract is token-agnostic so other assets can plug in without redeploying.",
  },
  {
    q: "What do I need to start?",
    a: "Just a phone. Sobre works on iPhone, Android, and any web browser. No KYC, no minimum deposit.",
  },
  {
    q: "How do I send money in?",
    a: "Pay in pesos via PDAX. InstaPay QR from your bank or e-wallet. PDAX converts to XLM and credits your Sobre wallet automatically; the contract splits across envelopes the moment it lands.",
  },
  {
    q: "Can I cash out to pesos?",
    a: "Yes. Through off-ramp partners like MoneyGram, you can cash out anywhere in the Philippines.",
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
      <SectionRail />
      <Hero />
      <Problem />
      <HowItWorks />
      <Product />
      <Trust />
      <TwoSides />
      <Faq openFaq={openFaq} setOpenFaq={setOpenFaq} />
      <FinalCTA />
      <Footer />
      <MobileCTABar />
    </>
  );
}

/**
 * "Open a Sobre" CTA that plays the envelope fly-out transition before
 * navigating to the dashboard. Renders as a real anchor (so it's still a
 * proper link / right-click-openable / keyboard-activatable) but intercepts
 * the plain click to run the animation first. Modifier-clicks and the reduced-
 * motion path fall through to normal navigation.
 */
function OpenSobreButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { playFlyout } = useEnvelopeTransition();
  return (
    <Link
      href="/dashboard"
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        playFlyout("/dashboard");
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Thumb-zone CTA pinned to the bottom of the viewport on phones/tablets so
 * "Open a Sobre" is always one tap away while the long marketing page scrolls.
 * Hidden on desktop (CSS), where the top-nav CTA does the job.
 */
function MobileCTABar() {
  return (
    <div className="sobre-bottom-bar">
      <OpenSobreButton className="sobre-bottom-cta">
        Open a Sobre
        <ArrowRightIcon weight="bold" size={18} />
      </OpenSobreButton>
    </div>
  );
}

const NAV_SECTIONS = [
  { id: "top", label: "Home" },
  { id: "problem", label: "The reality" },
  { id: "how", label: "How it works" },
  { id: "product", label: "The product" },
  { id: "trust", label: "Why this works" },
  { id: "two-sides", label: "Two sides" },
  { id: "about", label: "FAQ" },
] as const;

/**
 * Tracks which landing-page section is currently in view, so the nav can
 * show a "you are here" cue as the user scrolls. Recomputes on every scroll
 * by picking whichever section's top is closest to (without passing) a line
 * near the top of the viewport — a plain IntersectionObserver was going
 * silent (and leaving the old section highlighted) whenever an anchor-link
 * jump landed a short section entirely outside its narrow intersection
 * band, so this always has an answer instead of only reacting to crossings.
 */
function useScrollSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const ANCHOR_LINE = 0.25; // 25% down the viewport

    const recompute = () => {
      const line = window.innerHeight * ANCHOR_LINE;
      let best: HTMLElement | null = null;
      let bestDelta = -Infinity;
      for (const el of sections) {
        const top = el.getBoundingClientRect().top;
        // Prefer the last section whose top has crossed the anchor line;
        // if none has (page hasn't scrolled yet), fall back to the first.
        if (top <= line && top > bestDelta) {
          bestDelta = top;
          best = el;
        }
      }
      setActive((best ?? sections[0]).id);
    };

    recompute();
    window.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [ids]);

  return active;
}

/**
 * True while the given section is in view. Used by the rail to know when
 * it's scrolled over the dark green Final CTA band, so it can flip its
 * palette — the light-page ticks that read fine on white/gray sections are
 * invisible on green, and vice versa.
 */
function useSectionInView(id: string): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

  return inView;
}

function Nav() {
  const wallet = usePasskeyWallet();
  const { status, address, connect } = wallet;
  const busy = status === "checking" || status === "creating";

  const connectButton = address ? (
    <WalletMenu wallet={wallet} />
  ) : (
    <button
      type="button"
      onClick={() => void connect()}
      className="sobre-btn-nav sobre-btn-nav-soft"
      disabled={busy}
    >
      {status === "checking"
        ? "Checking…"
        : status === "creating"
          ? "Setting up…"
          : "Continue with Google"}
    </button>
  );

  return (
    <SiteHeader
      right={
        <>
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
        </>
      }
    />
  );
}

/**
 * Fixed side rail (desktop only) showing every major landing-page section as
 * a tick; the tick for whichever section is currently in view is highlighted
 * and labeled, so there's always a "you are here" cue while scrolling.
 */
function SectionRail() {
  const active = useScrollSpy(NAV_SECTIONS.map((s) => s.id));
  const onDark = useSectionInView("final-cta");

  return (
    <nav
      className={`sobre-rail${onDark ? " on-dark" : ""}`}
      aria-label="Page sections"
    >
      {NAV_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={`sobre-rail-item${active === s.id ? " active" : ""}`}
        >
          <span className="dot" aria-hidden />
          <span className="label">{s.label}</span>
        </a>
      ))}
    </nav>
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
            The shared family wallet for overseas workers. Every deposit
            splits into envelopes the household agreed on, the moment it
            arrives.
          </p>
          <OpenSobreButton className="sobre-hero-cta">
            Open a Sobre
            <ArrowRightIcon weight="bold" size={16} />
          </OpenSobreButton>
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
      id="problem"
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

        <Reveal className="sobre-stat-grid" data-stagger="">
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
        </Reveal>
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

        <Reveal className="sobre-steps" data-stagger="">
          {STEPS.map((s) => (
            <div key={s.num} className="sobre-step">
              <div className="sobre-step-num">{s.num}</div>
              <div className="sobre-step-fil">{s.fil}</div>
              <p>{s.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function Product() {
  return (
    <section
      id="product"
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
    <Reveal className={`sobre-feat-row${reverse ? " reverse" : ""}`}>
      {children}
    </Reveal>
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
      <BalanceHero state={PREVIEW_STATE}>
        <EnvelopeSplitCard state={PREVIEW_STATE} onOpen={() => {}} />
      </BalanceHero>
    </div>
  );
}

function MembersVisual() {
  return (
    <div className="sobre-feat-visual">
      <div className="sobre-label" style={{ marginBottom: 14 }}>
        Household policy
      </div>
      <div className="sobre-policy-stack">
        <PolicyRow
          icon={<ClockIcon weight="fill" size={18} />}
          title="Daily limit per member"
          value="₱ 500"
        />
        <PolicyRow
          icon={<LockIcon weight="fill" size={18} />}
          title="Tuition needs approval"
          value="Locked"
          locked
        />
        <PolicyRow
          icon={<LockIcon weight="fill" size={18} />}
          title="Savings needs approval"
          value="Locked"
          locked
        />
        <div
          className="sobre-card-flat"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            border: "1.5px dashed var(--border-strong)",
            padding: "14px 16px",
            marginTop: 6,
            color: "var(--text-3)",
            fontSize: 13,
            lineHeight: 1.4,
            boxShadow: "none",
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
  locked,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  locked?: boolean;
}) {
  return (
    <div
      className="sobre-card-flat"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          flexShrink: 0,
          borderRadius: 10,
          background: locked ? "var(--sobre-danger-soft)" : "var(--accent-soft)",
          display: "grid",
          placeItems: "center",
          color: locked ? "var(--sobre-danger)" : "var(--sobre-accent)",
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "var(--text-1)" }}>
        {title}
      </div>
      <span
        className="sobre-pill"
        style={{
          fontSize: 12,
          fontWeight: 600,
          background: locked ? "var(--sobre-danger-soft)" : "var(--accent-soft)",
          color: locked ? "var(--sobre-danger)" : "var(--sobre-accent)",
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
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <div className="sobre-label">Savings envelope</div>
          <div
            className="tabular"
            style={{
              fontSize: 34,
              fontWeight: 700,
              color: "var(--text-1)",
              marginTop: 8,
              letterSpacing: "-0.01em",
            }}
          >
            ₱11,856.90
          </div>
          <div
            className="tabular"
            style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}
          >
            204.43 XLM
          </div>
        </div>
        <span
          className="sobre-pill sobre-pill-soft-green"
          style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, flexShrink: 0 }}
        >
          <TrendUpIcon weight="bold" size={12} />
          Est. 4.5% APY
        </span>
      </div>
      <svg
        viewBox="0 0 400 120"
        style={{ marginTop: 26, width: "100%", height: 140 }}
        preserveAspectRatio="none"
      >
        <defs>
          {/* stopColor/stroke moved to style: SVG presentation attributes
              don't resolve var(), CSS properties do. */}
          <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopOpacity="0.25"
              style={{ stopColor: "var(--sobre-accent)" }}
            />
            <stop
              offset="100%"
              stopOpacity="0"
              style={{ stopColor: "var(--sobre-accent)" }}
            />
          </linearGradient>
        </defs>
        <line
          x1="0"
          y1="119"
          x2="400"
          y2="119"
          strokeWidth={1}
          style={{ stroke: "var(--border)" }}
        />
        <path
          d="M0,100 L40,92 L80,86 L120,80 L160,70 L200,66 L240,58 L280,50 L320,38 L360,28 L400,18 L400,120 L0,120 Z"
          fill="url(#sparkfill)"
        />
        <path
          d="M0,100 L40,92 L80,86 L120,80 L160,70 L200,66 L240,58 L280,50 L320,38 L360,28 L400,18"
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: "var(--sobre-accent)" }}
        />
        <circle cx="400" cy="18" r="4" style={{ fill: "var(--sobre-accent)" }} />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-3)",
          marginTop: 6,
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
    <section id="trust" className="sobre-section">
      <div className="sobre-container">
        <div className="sobre-section-head">
          <div className="sobre-eyebrow">Why this works</div>
          <h2 className="sobre-h2" style={{ marginTop: 10 }}>
            Built on infrastructure you can audit.
          </h2>
          <p className="sobre-lede" style={{ marginTop: 16 }}>
            Sobre is built on Stellar, the same chain used by MoneyGram for
            cross-border payouts. Your balance lives in XLM today, with USDC
            on the roadmap, so amounts can settle to a stablecoin without a
            contract redeploy. Every transaction is public and verifiable.
          </p>
        </div>

        <Reveal className="sobre-trust-grid" data-stagger="">
          {TRUST.map((t) => (
            <div key={t.title} className="sobre-trust-card">
              <div className="icon">{t.icon}</div>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function TwoSides() {
  return (
    <section
      id="two-sides"
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

        <Reveal className="sobre-duo">
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
        </Reveal>
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
                <CaretDownIcon
                  weight="bold"
                  size={20}
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
    <section id="final-cta" className="sobre-final-cta">
      <div className="sobre-container">
        <h2>
          <em className="sobre-em">Open the Sobre.</em> Open the plan.
        </h2>
        <p className="lede sobre-lede">
          Open a wallet in 60 seconds. Invite your family. Send your first
          remittance.
        </p>
        <OpenSobreButton className="sobre-btn-cream sobre-final-cta-btn">
          Start with Sobre, free
          <ArrowRightIcon weight="bold" size={16} />
        </OpenSobreButton>
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
