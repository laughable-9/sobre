"use client";

import { useEffect, useMemo, useState } from "react";
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
  Trash2,
} from "lucide-react";

import {
  SplitEditor,
  isValidSplit,
  type Split,
} from "@/components/sobre/SplitEditor";
import {
  DEFAULT_ENVELOPE_NAMES,
  EnvelopeNamesEditor,
  isValidEnvelopeNames,
  lockSavings,
  type EnvelopeNames,
} from "@/components/sobre/EnvelopeNamesEditor";
import {
  createFamilyWallet,
  deriveFamilyName,
} from "@/lib/familyWallets";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { findOrCreateWallet, type WalletRow } from "@/lib/wallets";

import { MobileScreen, PrimaryCta } from "../mockup/_shared";
import {
  BigTitle,
  Eyebrow,
  GoogleCta,
  GoogleG,
  Question,
  Section,
  SignInLink,
  SummaryRow,
  TermsLine,
} from "./_ui";

/**
 * Creator onboarding — the real flow (promoted from /mockup/setup).
 *
 *   1  Google sign-in       → Supabase session → passkey smart wallet
 *   2  Household type        → off-chain family_wallets.household_type
 *   3  Monthly budget range  → off-chain budget_min / budget_max (drives the
 *                              split-preview pesos)
 *   4  Members + roles       → collected into local state ONLY. Role is a
 *                              cosmetic off-chain label; the contract enforces
 *                              a single admin + flat members. Invites are minted
 *                              AFTER the wallet exists (see step 6 → /onboarding
 *                              redirects to the invite screen on the dashboard).
 *   5  Envelopes + split     → real EnvelopeNamesEditor + SplitEditor (Savings
 *                              locked)
 *   6  Name + create         → createFamilyWallet (admin-only on chain) →
 *                              dashboard. Members are invited there, on demand.
 *
 * Everything the contract enforces (auto-split, protected Savings, >PHP10k
 * hold, roles) is set up by the create call + downstream; onboarding only feeds
 * the initial values and NEVER promises powers the contract can't back.
 */

const TOTAL = 6;

type HouseholdType = "family-at-home" | "both-abroad" | "scratch";
type MemberRole = "admin" | "recipient";

interface MemberDraft {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
}

/** Preset monthly-budget bands (whole PHP). The midpoint drives the split
 *  preview; the min/max persist as budget_min/budget_max. */
const BUDGET_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under ₱15,000", min: 0, max: 15_000 },
  { label: "₱15,000 – ₱30,000", min: 15_000, max: 30_000 },
  { label: "₱30,000 – ₱60,000", min: 30_000, max: 60_000 },
  { label: "Over ₱60,000", min: 60_000, max: 120_000 },
];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());

export default function OnboardingFlow() {
  const [step, setStep] = useState(1);
  const [session, setSession] = useState<Session | null>(null);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [walletStatus, setWalletStatus] = useState<
    "idle" | "creating" | "error"
  >("idle");
  // Lazy-init from the OAuth callback's ?auth_error param (read once at mount)
  // so we don't need a setState-in-effect just to surface it.
  const [authError, setAuthError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("auth_error");
  });

  // Onboarding config
  const [householdType, setHouseholdType] =
    useState<HouseholdType>("family-at-home");
  const [budgetBand, setBudgetBand] = useState(1); // index into BUDGET_BANDS
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [envelopeNames, setEnvelopeNames] = useState<EnvelopeNames>(
    DEFAULT_ENVELOPE_NAMES,
  );
  const [split, setSplit] = useState<Split>([50, 30, 20]);
  // `null` = the user hasn't typed a name yet, so we show the derived default.
  // Once they edit (even to ""), we respect their input.
  const [walletNameInput, setWalletNameInput] = useState<string | null>(null);

  const [setupStatus, setSetupStatus] = useState<
    "idle" | "creating" | "error"
  >("idle");
  const [setupError, setSetupError] = useState<string | null>(null);
  const router = useRouter();

  const adminName =
    session?.user.user_metadata?.full_name ?? session?.user.email ?? "Sobre";

  // Derived default until the user types — no effect / no setState needed.
  const defaultWalletName = deriveFamilyName(adminName);
  const walletName = walletNameInput ?? defaultWalletName;
  const setWalletName = (v: string) => setWalletNameInput(v);

  const band = BUDGET_BANDS[budgetBand];
  const previewDeposit = Math.round((band.min + band.max) / 2) || band.max;

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

  // When a session lands and we don't yet have a wallet, fire passkey signup
  // (or silent reconnect) and advance to Step 2 once the row is in Supabase.
  // This is a genuine external-sync effect (kicks off an async wallet deploy);
  // the guard makes it one-shot. The rule flags the synchronous status flip.
  useEffect(() => {
    if (!session || wallet || walletStatus !== "idle") return;
    const displayName =
      session.user.user_metadata?.full_name ?? session.user.email ?? "Sobre";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot guard above; kicks off async deploy
    setWalletStatus("creating");
    findOrCreateWallet(session.user.id, displayName, session.user.email ?? "")
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
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    if (error) setAuthError(error.message);
  }

  async function handleCreate() {
    if (!wallet || !session) {
      setSetupError("Sign in is required before creating a family wallet.");
      setSetupStatus("error");
      return;
    }
    if (!isValidSplit(split) || !isValidEnvelopeNames(envelopeNames)) {
      setSetupError("Check the envelope names and split before creating.");
      setSetupStatus("error");
      return;
    }
    if (walletName.trim().length === 0) {
      setSetupError("Give your Sobre a name.");
      setSetupStatus("error");
      return;
    }

    setSetupError(null);
    setSetupStatus("creating");
    try {
      const trimmed = lockSavings(
        envelopeNames.map((n) => n.trim()) as EnvelopeNames,
      );
      const { familyContractId } = await createFamilyWallet({
        myWalletContractId: wallet.contract_id,
        myWalletDbId: wallet.id,
        envelopeNames: trimmed,
        percents: split,
        walletName: walletName.trim(),
        adminName,
        adminEmoji: "🌴",
        householdType,
        budgetMin: band.min,
        budgetMax: band.max,
      });
      // Members are invited on demand from the dashboard — carry the drafts
      // over so the invite panel can pre-fill names/roles. sessionStorage keeps
      // them off the URL and out of the network.
      const invitable = members.filter((m) => m.name.trim().length > 0);
      if (invitable.length > 0) {
        try {
          sessionStorage.setItem(
            `sobre.onboarding.invites.${familyContractId}`,
            JSON.stringify(invitable),
          );
        } catch {
          // storage refused; the admin can still invite manually
        }
      }
      router.push(`/dashboard/${familyContractId}?invite=1`);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : String(err));
      setSetupStatus("error");
    }
  }

  /* ── Step 1 · Google sign-in ─────────────────────────────────────── */
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
                className="mt-2.5 text-center text-[12px]"
                style={{ color: "var(--sobre-danger)" }}
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
              By continuing you agree to Sobre&apos;s <u>Terms</u> and{" "}
              <u>Privacy</u>.
            </TermsLine>
          </>
        }
      >
        <WelcomeHero />
      </MobileScreen>
    );
  }

  /* ── Step 2 · Household type ─────────────────────────────────────── */
  if (step === 2) {
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
          selected={householdType === "family-at-home"}
          onClick={() => setHouseholdType("family-at-home")}
        />
        <ChoiceCard
          icon={<Plane size={20} strokeWidth={2} />}
          title="Both working abroad"
          sub="Two workers, family back home"
          selected={householdType === "both-abroad"}
          onClick={() => setHouseholdType("both-abroad")}
        />
        <ChoiceCard
          icon={<Sparkles size={20} strokeWidth={2} />}
          title="Start from scratch"
          sub="Build your own structure"
          selected={householdType === "scratch"}
          onClick={() => setHouseholdType("scratch")}
        />
      </MobileScreen>
    );
  }

  /* ── Step 3 · Monthly budget range ───────────────────────────────── */
  if (step === 3) {
    return (
      <MobileScreen
        title="Monthly budget"
        step={3}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            Continue
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Question>Roughly how much do you send each month?</Question>
        <p className="mb-4 text-[13px]" style={{ color: "var(--text-2)" }}>
          Just an estimate — it sets the preview amounts on the next steps. You
          can change it anytime.
        </p>
        {BUDGET_BANDS.map((b, i) => (
          <ChoiceCard
            key={b.label}
            title={b.label}
            sub={i === budgetBand ? "Selected" : "Tap to choose"}
            selected={i === budgetBand}
            onClick={() => setBudgetBand(i)}
          />
        ))}
      </MobileScreen>
    );
  }

  /* ── Step 4 · Members + roles ────────────────────────────────────── */
  if (step === 4) {
    const addMember = (role: MemberRole) =>
      setMembers((m) => [
        ...m,
        { id: newId(), name: "", email: "", role },
      ]);
    const update = (id: string, patch: Partial<MemberDraft>) =>
      setMembers((m) =>
        m.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
    const remove = (id: string) =>
      setMembers((m) => m.filter((row) => row.id !== id));

    const coAdmins = members.filter((m) => m.role === "admin");
    const recipients = members.filter((m) => m.role === "recipient");

    return (
      <MobileScreen
        title="Add members"
        step={4}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            {members.length > 0 ? "Done, continue" : "Skip for now"}
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Question>Who&apos;s in this Sobre?</Question>
        <p className="mb-4 text-[13px]" style={{ color: "var(--text-2)" }}>
          Add them now to pre-fill their invite links after you create the
          wallet. You can also invite people later from the dashboard.
        </p>

        <Section>You</Section>
        <MemberRow
          fixed
          name={`${adminName} (you)`}
          roleLabel="Admin"
        />

        <Section>Co-Admins</Section>
        {coAdmins.map((m) => (
          <MemberEditRow
            key={m.id}
            member={m}
            onChange={(patch) => update(m.id, patch)}
            onRemove={() => remove(m.id)}
          />
        ))}
        <AddRow
          label="Add another Admin"
          onClick={() => addMember("admin")}
        />

        <Section>Recipients</Section>
        {recipients.map((m) => (
          <MemberEditRow
            key={m.id}
            member={m}
            onChange={(patch) => update(m.id, patch)}
            onRemove={() => remove(m.id)}
          />
        ))}
        <AddRow
          label="Add a Recipient"
          onClick={() => addMember("recipient")}
        />

        <p
          className="mt-4 text-[11px] leading-relaxed"
          style={{ color: "var(--text-3)" }}
        >
          Roles control what each person sees in the app. On-chain, you are the
          wallet&apos;s single admin — fund controls stay with you.
        </p>
      </MobileScreen>
    );
  }

  /* ── Step 5 · Envelopes + split ──────────────────────────────────── */
  if (step === 5) {
    const envelopesOk =
      isValidEnvelopeNames(envelopeNames) && isValidSplit(split);
    return (
      <MobileScreen
        title="Envelopes"
        step={5}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={envelopesOk ? next : () => undefined}>
            Confirm envelopes
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Question>Name your envelopes and set the split</Question>
        <div className="sobre-input-group">
          <label>Envelope names</label>
          <p className="-mt-1 mb-3 text-[12px]" style={{ color: "var(--text-3)" }}>
            What you call each envelope (e.g. Rent, School, Vacation).
          </p>
          <EnvelopeNamesEditor
            value={envelopeNames}
            onChange={setEnvelopeNames}
          />
        </div>
        <div className="sobre-input-group mt-5">
          <label>Every deposit splits</label>
          <p className="-mt-1 mb-3 text-[12px]" style={{ color: "var(--text-3)" }}>
            Preview on ~₱{previewDeposit.toLocaleString()} / month. Change
            anytime.
          </p>
          <SplitEditor value={split} onChange={setSplit} labels={envelopeNames} />
          <SplitPreview
            split={split}
            names={envelopeNames}
            deposit={previewDeposit}
          />
        </div>
      </MobileScreen>
    );
  }

  /* ── Step 6 · Name + create ──────────────────────────────────────── */
  const busy = setupStatus === "creating";
  const invitable = members.filter((m) => m.name.trim().length > 0).length;
  return (
    <MobileScreen
      title="Confirm and create"
      step={6}
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
              className="mt-2.5 break-all text-center text-[12px]"
              style={{ color: "var(--sobre-danger)" }}
            >
              {setupError}
            </p>
          )}
        </>
      }
    >
      <Eyebrow>Almost there</Eyebrow>
      <div className="sobre-input-group mt-2">
        <label htmlFor="wallet-name">Sobre name</label>
        <input
          id="wallet-name"
          className="sobre-input"
          type="text"
          placeholder="The Santos Family"
          value={walletName}
          onChange={(e) => setWalletName(e.target.value)}
          disabled={busy}
          maxLength={40}
        />
      </div>
      <BigTitle>{walletName.trim() || deriveFamilyName(adminName)}</BigTitle>
      <div className="mt-4">
        <SummaryRow label="Admin" value={adminName} />
        <SummaryRow label="Household" value={householdLabel(householdType)} />
        <SummaryRow
          label="Budget"
          value={`₱${band.min.toLocaleString()} – ₱${band.max.toLocaleString()}`}
        />
        <SummaryRow
          label="Envelopes"
          value={envelopeNames.join(", ")}
        />
        <SummaryRow label="Split" value={split.join(" / ")} />
        <SummaryRow label="Savings" value="Protected" green />
        <SummaryRow
          label="To invite"
          value={invitable === 0 ? "None yet" : `${invitable} member(s)`}
          muted={invitable === 0}
        />
      </div>
    </MobileScreen>
  );
}

/* ─────────────────────────── helpers ─────────────────────────────── */

function householdLabel(t: HouseholdType): string {
  return t === "family-at-home"
    ? "Family at home"
    : t === "both-abroad"
      ? "Both abroad"
      : "From scratch";
}

function SplitPreview({
  split,
  names,
  deposit,
}: {
  split: Split;
  names: EnvelopeNames;
  deposit: number;
}) {
  const rows = useMemo(
    () =>
      names.map((name, i) => ({
        name,
        pct: split[i],
        peso: Math.round((split[i] * deposit) / 100),
        savings: i === 2,
      })),
    [names, split, deposit],
  );
  return (
    <div className="mt-4 space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between">
          <span className="text-[13px]" style={{ color: "var(--text-2)" }}>
            {r.name}
          </span>
          <span
            className="tabular text-[13px] font-semibold"
            style={{
              color: r.savings ? "var(--sobre-accent)" : "var(--text-1)",
            }}
          >
            {r.pct}% · ₱{r.peso.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  sub,
  selected,
  onClick,
}: {
  icon?: React.ReactNode;
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
      className="mb-2.5 flex items-center gap-3.5"
      style={{
        background: selected ? "var(--surface-alt)" : "var(--surface)",
        border: `1.5px solid ${selected ? "var(--sobre-primary)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {icon ? (
        <div
          className="grid flex-shrink-0 place-items-center"
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: selected ? "var(--sobre-primary)" : "var(--surface-alt)",
            color: selected ? "#fff" : "var(--text-1)",
          }}
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[12px]" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      </div>
      {selected && (
        <Check size={18} strokeWidth={2.5} color="var(--sobre-primary)" />
      )}
    </div>
  );
}

/** Read-only member row (the admin/you). */
function MemberRow({
  name,
  roleLabel,
}: {
  fixed?: boolean;
  name: string;
  roleLabel: string;
}) {
  return (
    <div
      className="mb-2 flex items-center gap-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        className="grid flex-shrink-0 place-items-center rounded-full text-[12px] font-bold"
        style={{
          width: 34,
          height: 34,
          background: "var(--accent-soft)",
          color: "var(--sobre-accent)",
        }}
      >
        {initialsOf(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{name}</div>
        <div className="text-[12px]" style={{ color: "var(--text-2)" }}>
          {roleLabel}
        </div>
      </div>
    </div>
  );
}

/** Editable member draft row: name + email + remove. */
function MemberEditRow({
  member,
  onChange,
  onRemove,
}: {
  member: MemberDraft;
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="mb-2 space-y-2"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div className="flex items-center gap-2">
        <input
          className="sobre-input flex-1"
          style={{ padding: "9px 11px", fontSize: 14 }}
          placeholder="Name"
          value={member.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={40}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="grid flex-shrink-0 place-items-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--sobre-danger)",
          }}
        >
          <Trash2 size={15} strokeWidth={2} />
        </button>
      </div>
      <input
        className="sobre-input"
        style={{ padding: "9px 11px", fontSize: 14 }}
        placeholder="Email (for their invite)"
        type="email"
        inputMode="email"
        value={member.email}
        onChange={(e) => onChange({ email: e.target.value })}
        maxLength={120}
      />
    </div>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-2.5 text-[13px] font-medium"
      style={{
        padding: "12px 14px",
        border: "1.5px dashed var(--border-strong)",
        borderRadius: 12,
        color: "var(--text-2)",
        background: "transparent",
      }}
    >
      <Plus size={16} strokeWidth={2} />
      {label}
    </button>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function WelcomeHero() {
  return (
    <div className="flex h-full flex-col items-center text-center">
      <div className="min-h-[24px] flex-1" />
      <Image
        src="/sobre-logo2.svg"
        alt="Sobre"
        width={84}
        height={84}
        priority
        className="mb-[18px]"
      />
      <h1
        className="m-0"
        style={{
          fontFamily: "var(--serif)",
          fontSize: 44,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--text-1)",
          lineHeight: 1,
        }}
      >
        Sobre
      </h1>
      <p
        className="mx-2 mt-4"
        style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          fontStyle: "italic",
          color: "var(--text-2)",
          lineHeight: 1.4,
          maxWidth: "26ch",
        }}
      >
        The shared family wallet for households who send and receive overseas.
      </p>
      <div className="min-h-[32px] flex-[2]" />
    </div>
  );
}
