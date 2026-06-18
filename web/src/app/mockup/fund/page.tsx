"use client";

import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CreditCard,
  QrCode,
  Wallet,
} from "lucide-react";

import { MobileScreen, PrimaryCta } from "../_shared";

const TOTAL = 4;

export default function FundFlow() {
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  if (step === 1) {
    return (
      <MobileScreen
        title="Add money"
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
        <Heading>How would you like to add money?</Heading>
        <Method
          icon={<Building2 size={22} strokeWidth={2} />}
          title="Bank transfer"
          sub="InstaPay or QRPh · ₱"
          selected
        />
        <Method
          icon={<CreditCard size={22} strokeWidth={2} />}
          title="Card"
          sub="Debit or credit · ₱"
        />
        <Method
          icon={<Wallet size={22} strokeWidth={2} />}
          title="Crypto (USDC)"
          sub="Stellar network"
        />
      </MobileScreen>
    );
  }

  if (step === 2) {
    return (
      <MobileScreen
        title="Scan to pay"
        step={2}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            I&apos;ve sent it
            <ArrowRight size={16} strokeWidth={2.5} />
          </PrimaryCta>
        }
      >
        <Heading>InstaPay · QRPh</Heading>
        <BigAmount>₱ 30,000.00</BigAmount>
        <BigAmountSub>≈ $534.50 USDC · 1 USD = ₱56.13</BigAmountSub>
        <div
          style={{
            margin: "26px auto 16px",
            width: 200,
            height: 200,
            borderRadius: 16,
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            display: "grid",
            placeItems: "center",
            color: "var(--text-1)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <QrCode size={156} strokeWidth={1.2} />
        </div>
        <RefRow label="Reference" value="SOB-9F2A1C" />
      </MobileScreen>
    );
  }

  if (step === 3) {
    return (
      <MobileScreen
        title="Confirm deposit"
        step={3}
        total={TOTAL}
        onBack={back}
        cta={
          <PrimaryCta onClick={next}>
            <Check size={16} strokeWidth={2.5} />
            Confirm and split
          </PrimaryCta>
        }
      >
        <Heading>Confirm deposit</Heading>
        <RateBlock />
        <Section>Split preview</Section>
        <SplitRow label="Daily needs · 40%" amount="₱ 12,000" />
        <SplitRow label="Bills · 25%" amount="₱ 7,500" />
        <SplitRow label="Kids · 20%" amount="₱ 6,000" />
        <SplitRow label="Savings · 15%" amount="₱ 4,500" green />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen
      title="Done"
      step={4}
      total={TOTAL}
      onBack={back}
      cta={
        <PrimaryCta onClick={() => setStep(1)}>
          See the envelopes
          <ArrowRight size={16} strokeWidth={2.5} />
        </PrimaryCta>
      }
    >
      <SuccessGlyph />
      <SuccessHead>Deposit complete</SuccessHead>
      <SuccessLine>₱ 30,000 split across 4 envelopes.</SuccessLine>
      <Section>What just happened</Section>
      <FeedLine
        who="Maria"
        what="deposited ₱30,000"
        where="from Hong Kong · InstaPay"
        time="just now"
      />
      <FeedLine
        who="Auto-split"
        what="distributed ₱30,000"
        where="40 / 25 / 20 / 15"
        time="just now"
        accent
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
        margin: "4px 0 8px",
        lineHeight: 1.2,
      }}
    >
      {children}
    </h2>
  );
}

function Subheading({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        color: "var(--text-2)",
        lineHeight: 1.5,
        margin: "0 0 22px",
      }}
    >
      {children}
    </p>
  );
}

function Method({
  icon,
  title,
  sub,
  selected,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        background: selected ? "#fbe7d2" : "var(--surface)",
        border: `1.5px solid ${selected ? "var(--sobre-primary)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 10,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
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

function BigAmount({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="tabular"
      style={{
        fontFamily: "var(--serif)",
        fontSize: 40,
        fontWeight: 600,
        color: "var(--sobre-primary)",
        letterSpacing: "-0.02em",
        textAlign: "center",
        marginTop: 8,
        lineHeight: 1,
      }}
    >
      {children}
    </div>
  );
}

function BigAmountSub({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--text-2)",
        textAlign: "center",
        marginTop: 6,
      }}
    >
      {children}
    </div>
  );
}

function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
      <span
        className="tabular"
        style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.04em" }}
      >
        {value}
      </span>
    </div>
  );
}

function RateBlock() {
  return (
    <div
      style={{
        background: "var(--accent-soft)",
        border: "1px solid #cfe0d4",
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-2)",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        <span>You send</span>
        <span>Wallet receives</span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          className="tabular"
          style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600 }}
        >
          ₱ 30,000.00
        </span>
        <span
          className="tabular"
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--sobre-accent)",
          }}
        >
          $534.50
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
        1 USD = ₱56.13 · rate locked for 30 sec
      </div>
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

function SplitRow({
  label,
  amount,
  green,
}: {
  label: string;
  amount: string;
  green?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        marginBottom: 6,
        fontSize: 14,
      }}
    >
      <span style={{ color: green ? "var(--sobre-accent)" : "var(--text-1)" }}>
        {label}
      </span>
      <span
        className="tabular"
        style={{
          fontWeight: 600,
          color: green ? "var(--sobre-accent)" : "var(--text-1)",
        }}
      >
        {amount}
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
        background: "var(--accent-soft)",
        color: "var(--sobre-accent)",
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
  time,
  accent,
}: {
  who: string;
  what: string;
  where: string;
  time: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: accent ? "#fff8ec" : "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ color: "var(--text-1)" }}>
        <b style={{ fontWeight: 600 }}>{who}</b>{" "}
        <span style={{ color: "var(--text-2)" }}>{what}</span>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
        {where} · {time}
      </div>
    </div>
  );
}
