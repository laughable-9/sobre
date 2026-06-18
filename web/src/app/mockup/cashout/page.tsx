"use client";

import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Fingerprint,
  Smartphone,
} from "lucide-react";

import { MobileScreen, PrimaryCta } from "../_shared";

const TOTAL = 4;

export default function CashoutFlow() {
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  if (step === 1) {
    return (
      <MobileScreen
        title="Cash out"
        step={1}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            Continue
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Heading>Where should this go?</Heading>
        <AvailableBar>
          <span>Available in Daily needs</span>
          <span className="tabular" style={{ fontWeight: 600 }}>
            ₱ 30,720
          </span>
        </AvailableBar>
        <Section>Saved destinations</Section>
        <Destination
          icon={<Building2 size={22} strokeWidth={2} />}
          label="BDO Savings"
          sub="•••• 4291 · InstaPay"
          selected
        />
        <Destination
          icon={<Smartphone size={22} strokeWidth={2} />}
          label="GCash"
          sub="•••• 0982"
        />
        <Destination
          icon={<Building2 size={22} strokeWidth={2} />}
          label="Security Bank"
          sub="•••• 7716"
        />
      </MobileScreen>
    );
  }

  if (step === 2) {
    return (
      <MobileScreen
        title="Amount"
        step={2}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            Confirm and verify
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Heading>How much to withdraw?</Heading>
        <AmountInput>
          <span style={{ color: "var(--text-3)", marginRight: 4 }}>₱</span>
          <span className="tabular">5,000</span>
        </AmountInput>
        <UsdcLine>≈ $89.08 USDC · 1 USD = ₱56.13</UsdcLine>
        <QuickAmounts />
        <Section>Going to</Section>
        <Destination
          icon={<Building2 size={22} strokeWidth={2} />}
          label="BDO Savings"
          sub="•••• 4291 · InstaPay"
          selected
        />
      </MobileScreen>
    );
  }

  if (step === 3) {
    return (
      <MobileScreen
        title="Verify it's you"
        step={3}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            <Fingerprint size={16} strokeWidth={2.5} />
            Authorize
          </PrimaryCta>
        }
      >
        <Heading>Confirm it&apos;s you.</Heading>
        <FingerprintBlock />
        <FallbackRow>Use a one-time code instead</FallbackRow>
        <Section>Withdrawal summary</Section>
        <SummaryRow label="To" value="BDO Savings •••• 4291" />
        <SummaryRow label="Amount" value="₱ 5,000.00" />
        <SummaryRow label="USDC equivalent" value="$89.08" />
        <SummaryRow label="Rate locked" value="₱56.13 · 30 sec" muted />
        <SummaryRow label="Method" value="InstaPay · real-time" muted />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen
      title="On its way"
      step={4}
      total={TOTAL}
      onBack={back}
      cta={
        <PrimaryCta onClick={() => setStep(1)}>
          Back to dashboard
          <ArrowRight size={16} strokeWidth={2.5} />
        </PrimaryCta>
      }
    >
      <SuccessGlyph />
      <SuccessHead>On its way</SuccessHead>
      <SuccessLine>₱5,000 to BDO Savings •••• 4291.</SuccessLine>
      <Section>Activity</Section>
      <FeedLine
        who="Joel"
        what="withdrew ₱5,000"
        where="Daily needs → BDO •••• 4291"
        status="Processing"
      />
    </MobileScreen>
  );
}

/* ---------- UI primitives ---------- */

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--serif)",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        margin: "4px 0 16px",
        lineHeight: 1.2,
      }}
    >
      {children}
    </h2>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        color: "var(--text-2)",
        lineHeight: 1.5,
        margin: "-8px 0 22px",
      }}
    >
      {children}
    </p>
  );
}

function AvailableBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--accent-soft)",
        color: "var(--sobre-accent)",
        borderRadius: 12,
        padding: "12px 14px",
        fontSize: 13,
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        margin: "18px 0 10px",
      }}
    >
      {children}
    </div>
  );
}

function Destination({
  icon,
  label,
  sub,
  selected,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        background: selected ? "#fbe7d2" : "var(--surface)",
        border: `1.5px solid ${selected ? "var(--sobre-primary)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
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
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>{sub}</div>
      </div>
      {selected && (
        <Check size={18} strokeWidth={2.5} color="var(--sobre-primary)" />
      )}
    </div>
  );
}

function AmountInput({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1.5px solid var(--sobre-primary)",
        borderRadius: 12,
        padding: "18px 18px",
        fontFamily: "var(--serif)",
        fontSize: 38,
        fontWeight: 600,
        color: "var(--text-1)",
        display: "flex",
        alignItems: "baseline",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </div>
  );
}

function UsdcLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8 }}>
      {children}
    </div>
  );
}

function QuickAmounts() {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
      {["1,000", "5,000", "10,000", "All"].map((v, i) => (
        <span
          key={v}
          style={{
            background: i === 1 ? "var(--sobre-primary)" : "var(--surface-alt)",
            color: i === 1 ? "#fff" : "var(--text-1)",
            borderRadius: 999,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ₱{v}
        </span>
      ))}
    </div>
  );
}

function FingerprintBlock() {
  return (
    <div
      style={{
        margin: "16px auto 18px",
        width: 140,
        height: 140,
        borderRadius: "50%",
        background: "var(--accent-soft)",
        color: "var(--sobre-accent)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Fingerprint size={72} strokeWidth={1.6} />
    </div>
  );
}

function FallbackRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: "var(--sobre-accent)",
        fontWeight: 600,
        textAlign: "center",
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
        fontSize: 14,
      }}
    >
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span
        className="tabular"
        style={{
          color: muted ? "var(--text-3)" : "var(--text-1)",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SuccessGlyph() {
  return (
    <div
      style={{
        width: 88,
        height: 88,
        borderRadius: "50%",
        background: "#fbe7d2",
        color: "var(--primary-hover)",
        display: "grid",
        placeItems: "center",
        margin: "16px auto 22px",
      }}
    >
      <Check size={44} strokeWidth={2.5} />
    </div>
  );
}

function SuccessHead({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--serif)",
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        textAlign: "center",
        margin: 0,
      }}
    >
      {children}
    </h2>
  );
}

function SuccessLine({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        color: "var(--text-2)",
        textAlign: "center",
        margin: "8px 12px 0",
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

function FeedLine({
  who,
  what,
  where,
  status,
}: {
  who: string;
  what: string;
  where: string;
  status: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <span>
          <b style={{ fontWeight: 600 }}>{who}</b>{" "}
          <span style={{ color: "var(--text-2)" }}>{what}</span>
        </span>
        <span
          style={{
            fontSize: 10,
            background: "#fdf3d8",
            color: "#b88b1c",
            padding: "3px 8px",
            borderRadius: 999,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {status}
        </span>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4 }}>
        {where}
      </div>
    </div>
  );
}

function FootHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--text-3)",
        marginTop: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
