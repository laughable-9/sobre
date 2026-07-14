"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  CaretDownIcon,
  ClockIcon,
  CurrencyDollarIcon,
  EyeIcon,
  GithubLogoIcon,
  LockIcon,
  ShieldIcon,
} from "@phosphor-icons/react";

import type { WalletState } from "@/hooks/useWalletState";
import { LOGO_SRC } from "@/lib/config";
import { LandingHeader } from "@/components/sobre/LandingHeader";
import { OpenSobreButton } from "@/components/sobre/OpenSobreButton";
import { Reveal } from "@/components/sobre/Reveal";
import { BalanceHero } from "@/components/sobre/BalanceHero";
import { EnvelopeSplitCard } from "@/components/sobre/EnvelopeSplitCard";

/**
 * Sample household state for the landing page's product preview — 50/30/20
 * across Groceries / Tuition / Savings. Feeds the real dashboard components
 * (BalanceHero, EnvelopeSplitCard) so the marketing preview always matches
 * the actual in-app design, not a hand-rolled lookalike. `balances` is set
 * by each consumer (SplitVisual animates its own values).
 */
const PREVIEW_STATE: WalletState = {
  admins: [],
  payment_token: "",
  wallet_name: "Sample family",
  envelope_names: [],
  envelope_icons: [],
  percents: [50, 30, 20],
  members: [],
  balances: [0n, 0n, 0n],
  subaccounts: [],
  policy: {
    requireAllSigs: false,
    dailyLimit: null,
    perTxThreshold: null,
    protectedEnvelopes: [],
  },
  savings_lock_all_admins: false,
  admin_count: 1,
  admin_cap: 2,
  earn: null,
  grow_enabled: false,
  grow_balance: 0n,
  grow_supplied_total: 0n,
  grow_withdrawn_total: 0n,
  grow_requests: [],
};

/** Fire once when `ref`'s element intersects the viewport. Returns a ref
 *  to attach + the current in-view boolean. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "0px 0px -15% 0px", threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

/** Animate a scalar from 0→1 over `durationMs` after `active` flips true.
 *  Callers apply their own easing on the returned progress. */
function useTween(active: boolean, durationMs: number, delayMs = 0) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (start === 0) start = now + delayMs;
      // Still inside the pre-start delay window — schedule the next frame
      // without a setState so React doesn't rerender for a value that's
      // still 0.
      if (now < start) {
        raf = requestAnimationFrame(step);
        return;
      }
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs, delayMs]);
  return progress;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

function tweenBig(progress: number, target: bigint): bigint {
  if (progress <= 0) return 0n;
  if (progress >= 1) return target;
  return (target * BigInt(Math.round(progress * 1_000_000))) / 1_000_000n;
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
      "Open a shared Sobre from your phone in under 60 seconds. Invite your family with a link.",
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
    title: "No bank in the middle",
    body: "Your money sits in your family's Sobre, not on a bank's books. Only you and the members you invite can move it.",
  },
  {
    icon: <EyeIcon weight="fill" size={18} />,
    title: "Nothing hidden",
    body: "Every deposit and every spend shows up in the activity feed for the whole household to see.",
  },
  {
    icon: <CurrencyDollarIcon weight="bold" size={18} />,
    title: "Practically no fees",
    body: "Sending, splitting, and moving money costs a fraction of a cent. Sobre doesn't add its own charge.",
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
  "Real-time visibility into the whole Sobre.",
  "Savings grows automatically while you focus on family.",
];

const FAQS = [
  {
    q: "Is Sobre a bank?",
    a: "No. Sobre is a shared account for your family, run by open software on the Stellar network. Your money is held as USDC, a digital dollar backed 1:1 by real US dollars in reserve, so it doesn't lose value like crypto can.",
  },
  {
    q: "What do I need to start?",
    a: "Just a phone. Sobre works on iPhone, Android, and any web browser. No ID upload, no minimum deposit.",
  },
  {
    q: "How do I send money in?",
    a: "Pay in pesos via PDAX using InstaPay QR from your bank or e-wallet. PDAX turns it into USDC and drops it into your Sobre automatically. Sobre splits it across your envelopes the moment it lands.",
  },
  {
    q: "Can I cash out to pesos?",
    a: "Yes. Through partners like MoneyGram, you can withdraw pesos anywhere in the Philippines.",
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
      <LandingHeader />
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

function Hero() {
  return (
    <section id="top" className="sobre-hero">
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
          <h2 className="sobre-h2">
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
          <h2 className="sobre-h2">
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
          <h2 className="sobre-h2">
            Not just an account.{" "}
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
                Money in your Savings envelope quietly earns interest while it
                sits. Better than leaving it in a regular bank account and
                watching inflation eat it.
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

// Stroop targets calibrated so BalanceHero / EnvelopeSplitCard renders
// hit clean-integer displays through the float drift in their
// floor(stroops × PHP_PER_USDC / 1e10) formatter:
//   - Total 1,607,588,000 stroops   → ₱10,000.00 exactly
//   - Groceries   803,794,000       → ₱5,000.00
//   - Tuition     482,276,400       → ₱3,000.00
//   - Savings     321,517,600       → ₱2,000.00
const TOTAL_STROOPS_TARGET = 1_607_588_000n;
const G_STROOPS_TARGET = 803_794_000n;
const T_STROOPS_TARGET = 482_276_400n;
const S_STROOPS_TARGET = 321_517_600n;

const PREVIEW_TOTAL_STATE: WalletState = {
  ...PREVIEW_STATE,
  balances: [TOTAL_STROOPS_TARGET, 0n, 0n],
};

function SplitVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  // Total stays fixed at ₱10,000.00 from the moment the section enters
  // view. Each envelope row's number counts up 0 → target over a short
  // 400ms tween with a hard ease-out — quick enough to feel like a
  // "landing" not a slow tick — and the three rows fire in sequence
  // so the viewer reads each one as it arrives.
  const gP = easeOutQuart(useTween(inView, 400, 300));
  const tP = easeOutQuart(useTween(inView, 400, 900));
  const sP = easeOutQuart(useTween(inView, 400, 1500));
  const envelopeState = useMemo<WalletState>(
    () => ({
      ...PREVIEW_STATE,
      balances: [
        tweenBig(gP, G_STROOPS_TARGET),
        tweenBig(tP, T_STROOPS_TARGET),
        tweenBig(sP, S_STROOPS_TARGET),
      ],
    }),
    [gP, tP, sP],
  );
  return (
    <div ref={ref} className="sobre-feat-visual">
      <BalanceHero state={PREVIEW_TOTAL_STATE}>
        <EnvelopeSplitCard state={envelopeState} onOpen={() => {}} />
      </BalanceHero>
    </div>
  );
}

function MembersVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [dailyOn, setDailyOn] = useState(false);
  const [savingsOn, setSavingsOn] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const t1 = window.setTimeout(() => setDailyOn(true), 400);
    const t2 = window.setTimeout(() => setSavingsOn(true), 1100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [inView]);
  return (
    <div ref={ref} className="sobre-feat-visual">
      <div className="sobre-label" style={{ marginBottom: 14 }}>
        Household policy
      </div>
      <div className="sobre-policy-stack">
        <PolicyRow
          icon={<ClockIcon weight="fill" size={18} />}
          title="Daily limit per admin"
          tint="accent"
          toggleOn={dailyOn}
        />
        <PolicyRow
          icon={<LockIcon weight="fill" size={18} />}
          title="Tuition needs approval"
          tint="muted"
          toggleOn={false}
        />
        <PolicyRow
          icon={<LockIcon weight="fill" size={18} />}
          title="Savings needs approval"
          subtitle="Always locked"
          tint="danger"
          toggleOn={savingsOn}
          toggleDisabled
        />
      </div>
    </div>
  );
}

function PolicyRow({
  icon,
  title,
  subtitle,
  tint,
  toggleOn,
  toggleDisabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tint: "accent" | "danger" | "muted";
  toggleOn: boolean;
  toggleDisabled?: boolean;
}) {
  const iconTint =
    tint === "danger"
      ? { bg: "var(--sobre-danger-soft)", fg: "var(--sobre-danger)" }
      : tint === "accent"
        ? { bg: "var(--accent-soft)", fg: "var(--sobre-accent)" }
        : { bg: "var(--surface-alt)", fg: "var(--text-3)" };
  const trackOn =
    tint === "danger" ? "var(--sobre-danger)" : "var(--sobre-accent)";
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
          background: iconTint.bg,
          color: iconTint.fg,
          display: "grid",
          placeItems: "center",
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "var(--text-1)",
            lineHeight: 1.25,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              fontWeight: 500,
              letterSpacing: "0.02em",
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {/* Non-interactive visual — the landing page is decorative.
       *  Transitions on background + transform so animated on-scroll
       *  toggles slide instead of snapping. */}
      <div
        aria-hidden
        style={{
          width: 44,
          height: 26,
          borderRadius: 999,
          padding: 2,
          background: toggleOn ? trackOn : "var(--border-strong)",
          transition: "background .3s ease",
          opacity: toggleDisabled ? 0.75 : 1,
          flexShrink: 0,
          position: "relative",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            display: "block",
            transform: `translateX(${toggleOn ? 18 : 0}px)`,
            transition: "transform .3s cubic-bezier(.4,.6,.2,1)",
          }}
        />
      </div>
    </div>
  );
}

function SavingsVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  // Slow ramps: principal + interest tick up together in step with the
  // sparkline drawing itself left-to-right. Interest starts slightly
  // later so it visibly trails the principal — implying return over
  // time rather than instant.
  const balP = easeOutCubic(useTween(inView, 2600));
  const interestP = easeOutCubic(useTween(inView, 3000, 500));
  const balancePhp = 11856.9 * balP;
  const interestPhp = 354.62 * interestP;
  const fmtPhp = (n: number) =>
    n.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <div ref={ref} className="sobre-feat-visual">
      <div className="sobre-label" style={{ marginBottom: 10 }}>
        Savings envelope
      </div>
      <div
        className="tabular"
        style={{
          fontSize: 34,
          fontWeight: 700,
          color: "var(--text-1)",
          letterSpacing: "-0.01em",
        }}
      >
        ₱{fmtPhp(balancePhp)}
      </div>
      <div
        className="tabular"
        style={{
          fontSize: 13,
          color: "var(--sobre-primary)",
          fontWeight: 600,
          marginTop: 6,
        }}
      >
        +₱{fmtPhp(interestPhp)} earned this year
      </div>

      <svg
        viewBox="0 0 400 120"
        style={{ marginTop: 22, width: "100%", height: 140 }}
        preserveAspectRatio="none"
      >
        <defs>
          {/* Hard-coded hex on <stop> so Safari <16.4 (which doesn't
              resolve CSS var() on SVG paints) still shows the green fill. */}
          <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22A45C" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22A45C" stopOpacity="0" />
          </linearGradient>
          {/* Clip the fill so it grows in step with the drawn stroke. */}
          <clipPath id="sparkclip">
            <rect x="0" y="0" width={400 * balP} height="120" />
          </clipPath>
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
          clipPath="url(#sparkclip)"
        />
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
      <p
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          marginTop: 14,
          lineHeight: 1.45,
        }}
      >
        Illustrative growth. Sobre does not guarantee any specific rate of
        return.
      </p>
    </div>
  );
}

function Trust() {
  return (
    <section id="trust" className="sobre-section">
      <div className="sobre-container">
        <div className="sobre-section-head">
          <h2 className="sobre-h2">
            Money you can <em className="sobre-em">actually trust.</em>
          </h2>
          <p className="sobre-lede" style={{ marginTop: 16 }}>
            Sobre runs on Stellar, the same network MoneyGram uses to move
            money worldwide. Your balance is held as USDC, a digital dollar
            backed 1:1 by real US dollars in reserve, so it doesn&apos;t lose
            value like crypto can. Every peso in and every peso out is
            recorded in the family&apos;s activity feed.
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
          <h2 className="sobre-h2">
            For the sender. For the family.{" "}
            <em className="sobre-em">Same wallet.</em>
          </h2>
        </div>

        <Reveal className="sobre-duo">
          <div className="sobre-duo-col surface">
            <h3>Send home with zero guesswork.</h3>
            <ul>
              {SENDER_POINTS.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="sobre-duo-col green">
            <h3>Each person has their own envelope.</h3>
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
          <h2 className="sobre-h2">Frequently asked questions</h2>
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
          Open a Sobre in 60 seconds. Invite your family. Send your first
          remittance.
        </p>
        <OpenSobreButton className="sobre-hero-cta">
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
        <div>
          <div className="sobre-brand">
            <Image
              src={LOGO_SRC}
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
        <div className="sobre-footer-bottom">
          <div>© 2026 Sobre</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              color: "var(--text-3)",
            }}
          >
            <Link
              href="/privacy"
              style={{ color: "var(--text-2)", fontSize: 13 }}
            >
              Privacy
            </Link>
            <a
              href="https://github.com/laughable-9/sobre"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <GithubLogoIcon weight="fill" size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
