"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  Check,
  Home,
  Plane,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";

import {
  createFamilyWallet,
  deriveFamilyName,
} from "@/lib/familyWallets";
import { initialsOf } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { findOrCreateWallet, type WalletRow } from "@/lib/wallets";

import { MobileScreen, PrimaryCta } from "../_shared";

const TOTAL = 5;

type HouseholdType = "family-at-home" | "both-abroad" | "scratch";

interface SetupEnvelope {
  name: string;
  percent: number;
}

interface SetupConfig {
  householdType: HouseholdType;
  envelopes: SetupEnvelope[];
}

const DEFAULT_ENVELOPES: SetupEnvelope[] = [
  { name: "Daily needs", percent: 50 },
  { name: "Tuition", percent: 25 },
  { name: "Savings", percent: 25 },
];

const DEFAULT_SETUP: SetupConfig = {
  householdType: "family-at-home",
  envelopes: DEFAULT_ENVELOPES,
};

export default function SetupFlow() {
  const [step, setStep] = useState(1);
  const [session, setSession] = useState<Session | null>(null);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [walletStatus, setWalletStatus] = useState<
    "idle" | "creating" | "error"
  >("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [config, setConfig] = useState<SetupConfig>(DEFAULT_SETUP);
  const [setupStatus, setSetupStatus] = useState<
    "idle" | "creating" | "error"
  >("idle");
  const [setupError, setSetupError] = useState<string | null>(null);
  const router = useRouter();

  const envSum = config.envelopes.reduce((s, e) => s + e.percent, 0);
  const envSumOk = envSum === 100;

  const adminName =
    session?.user.user_metadata?.full_name ?? session?.user.email ?? "Sobre";
  const familyName = deriveFamilyName(adminName);

  async function handleCreate() {
    if (!wallet || !session) {
      setSetupError("Sign in is required before creating a family wallet.");
      setSetupStatus("error");
      return;
    }
    if (!envSumOk) {
      setSetupError(
        `Envelope percentages must sum to 100 (currently ${envSum}).`,
      );
      setSetupStatus("error");
      return;
    }

    setSetupError(null);
    setSetupStatus("creating");
    try {
      const { familyContractId } = await createFamilyWallet({
        myWalletContractId: wallet.contract_id,
        myWalletDbId: wallet.id,
        envelopeNames: [
          config.envelopes[0].name,
          config.envelopes[1].name,
          config.envelopes[2].name,
        ],
        percents: [
          config.envelopes[0].percent,
          config.envelopes[1].percent,
          config.envelopes[2].percent,
        ],
        walletName: familyName,
        adminName,
        adminEmoji: "🌴",
      });
      router.push(`/dashboard/${familyContractId}`);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : String(err));
      setSetupStatus("error");
    }
  }

  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  // Subscribe to Supabase session. On bounce-back from /auth/callback the
  // session lands in cookies; this picks it up and triggers wallet bootstrap.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Surface ?auth_error from the OAuth callback if Google rejected us.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) setAuthError(err);
  }, []);

  // When a session lands and we don't yet have a wallet, fire passkey signup
  // (or silent reconnect if returning) and advance to Step 2 once the row is
  // in Supabase.
  useEffect(() => {
    if (!session || wallet || walletStatus !== "idle") return;
    setWalletStatus("creating");
    findOrCreateWallet(session)
      .then(({ wallet: w }) => {
        setWallet(w);
        setWalletStatus("idle");
        setStep(2);
      })
      .catch((err: unknown) => {
        setAuthError(err instanceof Error ? err.message : String(err));
        setWalletStatus("error");
      });
  }, [session, wallet, walletStatus]);

  async function handleGoogleSignIn() {
    setAuthError(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/mockup/setup`,
      },
    });
    if (error) setAuthError(error.message);
  }

  if (step === 1) {
    const busy = walletStatus === "creating";
    return (
      <MobileScreen
        step={1}
        total={TOTAL}
        onBack={back}
        cta={
          <>
            <GoogleCta onClick={handleGoogleSignIn} disabled={busy}>
              <GoogleG size={18} />
              {busy ? "Setting up your wallet…" : "Continue with Google"}
            </GoogleCta>
            {authError && (
              <p
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "#c0392b",
                  textAlign: "center",
                }}
              >
                {authError}
              </p>
            )}
            <SignInLink>
              Already have an account?{" "}
              <span style={{ color: "var(--text-1)", fontWeight: 600 }}>
                Sign in
              </span>
            </SignInLink>
            <TermsLine>
              By continuing you agree to Sobre&apos;s{" "}
              <u>Terms</u> and <u>Privacy</u>.
            </TermsLine>
          </>
        }
      >
        <WelcomeHero />
      </MobileScreen>
    );
  }

  if (step === 2) {
    const setHousehold = (value: HouseholdType) =>
      setConfig((c) => ({ ...c, householdType: value }));
    return (
      <MobileScreen
        title="Household type"
        step={2}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            Continue
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Question>What best describes your household?</Question>
        <ChoiceCard
          icon={<Home size={20} strokeWidth={2} />}
          title="Supporting family at home"
          sub="Worker abroad + family in PH"
          selected={config.householdType === "family-at-home"}
          onClick={() => setHousehold("family-at-home")}
        />
        <ChoiceCard
          icon={<Plane size={20} strokeWidth={2} />}
          title="Both working abroad"
          sub="Two workers, family back home"
          selected={config.householdType === "both-abroad"}
          onClick={() => setHousehold("both-abroad")}
        />
        <ChoiceCard
          icon={<Sparkles size={20} strokeWidth={2} />}
          title="Start from scratch"
          sub="Build your own structure"
          selected={config.householdType === "scratch"}
          onClick={() => setHousehold("scratch")}
        />
      </MobileScreen>
    );
  }

  if (step === 3) {
    const youName =
      session?.user.user_metadata?.full_name ?? session?.user.email ?? "You";
    return (
      <MobileScreen
        title="Add members"
        step={3}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            Done, continue
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Question>Who&apos;s in this Sobre?</Question>
        <Section>Co-Admins</Section>
        <Person
          initials={initialsOf(youName)}
          name={`${youName} (you)`}
          role="Admin"
        />
        <AddRow label="Add another Admin" />
        <Section>Recipients</Section>
        <AddRow label="Add a Recipient" />
      </MobileScreen>
    );
  }

  if (step === 4) {
    return (
      <MobileScreen
        title="Envelope split"
        step={4}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            Confirm split
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Question>How should every deposit split?</Question>
        {config.envelopes.map((env, i) => (
          <EnvRow
            key={env.name}
            name={env.name}
            pct={env.percent}
            amount={`₱ ${pesoFor(env.percent).toLocaleString()}`}
            locked={env.name === "Savings"}
          />
        ))}
        <SumRow sum={envSum} ok={envSumOk} />
      </MobileScreen>
    );
  }

  const busy = setupStatus === "creating";
  const envSummary = `3 · ${config.envelopes.map((e) => e.percent).join(" / ")}`;

  return (
    <MobileScreen
      title="Confirm and create"
      step={5}
      total={TOTAL}
      onBack={busy ? () => undefined : back}
      cta={
        <>
          <PrimaryCta onClick={busy ? () => undefined : handleCreate}>
            {busy ? (
              "Creating your family wallet…"
            ) : (
              <>
                <Send size={16} strokeWidth={2.5} />
                Create wallet
              </>
            )}
          </PrimaryCta>
          {setupError && (
            <p
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "#c0392b",
                textAlign: "center",
              }}
            >
              {setupError}
            </p>
          )}
        </>
      }
    >
      <Eyebrow>All set</Eyebrow>
      <BigTitle>{familyName}</BigTitle>
      <div style={{ marginTop: 24 }}>
        <SummaryRow label="Admin" value={adminName} />
        <SummaryRow
          label="Envelopes"
          value={config.envelopes.map((e) => e.name).join(", ")}
        />
        <SummaryRow label="Split" value={envSummary} />
        <SummaryRow label="Savings" value="Protected" green />
        <SummaryRow
          label="Smart wallet"
          value={
            wallet?.contract_id
              ? `${wallet.contract_id.slice(0, 6)}…${wallet.contract_id.slice(-4)}`
              : "—"
          }
          muted
        />
      </div>
    </MobileScreen>
  );
}

/* ---------- inline UI primitives ---------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function BigTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: "var(--serif)",
        fontSize: 32,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        margin: "6px 0 12px",
        lineHeight: 1.1,
      }}
    >
      {children}
    </h1>
  );
}

function Question({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--serif)",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        margin: "0 0 18px",
        lineHeight: 1.2,
      }}
    >
      {children}
    </h2>
  );
}

function ChoiceCard({
  icon,
  title,
  sub,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        background: selected ? "#fbe7d2" : "var(--surface)",
        border: `1.5px solid ${selected ? "var(--sobre-primary)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 10,
        display: "flex",
        alignItems: "center",
        gap: 14,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: selected ? "var(--sobre-primary)" : "var(--surface-alt)",
          color: selected ? "#fff" : "var(--text-1)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
          {sub}
        </div>
      </div>
      {selected && (
        <Check size={18} strokeWidth={2.5} color="var(--sobre-primary)" />
      )}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-2)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        margin: "18px 0 8px",
      }}
    >
      {children}
    </div>
  );
}

function Person({
  initials,
  name,
  role,
  green,
}: {
  initials: string;
  name: string;
  role: string;
  green?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: green ? "var(--accent-soft)" : "#fbe7d2",
          color: green ? "var(--sobre-accent)" : "var(--primary-hover)",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>{role}</div>
      </div>
    </div>
  );
}

function AddRow({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        border: "1.5px dashed var(--border-strong)",
        borderRadius: 12,
        color: "var(--text-2)",
        fontSize: 13,
        fontWeight: 500,
        marginBottom: 8,
      }}
    >
      <Plus size={16} strokeWidth={2} />
      {label}
    </div>
  );
}

function EnvRow({
  name,
  pct,
  amount,
  locked,
}: {
  name: string;
  pct: number;
  amount: string;
  locked?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {name}
          {locked && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                fontWeight: 700,
                color: "var(--sobre-accent)",
                background: "var(--accent-soft)",
                padding: "2px 7px",
                borderRadius: 999,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Protected
            </span>
          )}
        </div>
        <div className="tabular" style={{ fontSize: 13, fontWeight: 600 }}>
          {pct}% · {amount}
        </div>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--surface-alt)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: locked ? "var(--sobre-accent)" : "var(--sobre-primary)",
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

function SumRow({ sum, ok }: { sum: number; ok: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        background: ok ? "var(--accent-soft)" : "#fbe2dd",
        color: ok ? "var(--sobre-accent)" : "#a13a2c",
        borderRadius: 12,
        padding: "12px 14px",
        fontSize: 13,
        fontWeight: 600,
        marginTop: 4,
      }}
    >
      <span>{ok ? "Total allocated" : "Allocate to 100%"}</span>
      <span>
        {sum}% · ₱ {pesoFor(sum).toLocaleString()}
      </span>
    </div>
  );
}

/** Indicative monthly deposit used purely for the split preview. */
const PREVIEW_DEPOSIT_PESOS = 30000;

function pesoFor(percent: number): number {
  return Math.round((percent * PREVIEW_DEPOSIT_PESOS) / 100);
}

function SummaryRow({
  label,
  value,
  muted,
  green,
}: {
  label: string;
  value: string;
  muted?: boolean;
  green?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "14px 0",
        borderBottom: "1px solid var(--border)",
        fontSize: 14,
      }}
    >
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span
        style={{
          color: muted
            ? "var(--text-3)"
            : green
              ? "var(--sobre-accent)"
              : "var(--text-1)",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function WelcomeHero() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div style={{ flex: 1, minHeight: 24 }} />
      <Image
        src="/sobre-logo2.svg"
        alt="Sobre"
        width={84}
        height={84}
        priority
        style={{ marginBottom: 18 }}
      />
      <h1
        style={{
          fontFamily: "var(--serif)",
          fontSize: 44,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--text-1)",
          margin: 0,
          lineHeight: 1,
        }}
      >
        Sobre
      </h1>
      <p
        style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          fontStyle: "italic",
          color: "var(--text-2)",
          margin: "16px 8px 0",
          lineHeight: 1.4,
          maxWidth: "26ch",
        }}
      >
        The shared family wallet for households who send and receive overseas.
      </p>
      <div style={{ flex: 2, minHeight: 32 }} />
    </div>
  );
}

function SignInLink({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 13,
        color: "var(--text-2)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function TermsLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        fontSize: 11,
        color: "var(--text-3)",
        textAlign: "center",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function GoogleCta({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        background: "var(--surface)",
        color: "var(--text-1)",
        border: "1.5px solid var(--border-strong)",
        borderRadius: 10,
        padding: "13px 16px",
        fontSize: 15,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        boxShadow: "var(--shadow-sm)",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "wait" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
