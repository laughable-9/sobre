"use client";

/**
 * Small presentational helpers for the onboarding flow. Token-only (no raw
 * hex) per the sobre-design-system skill.
 */

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] uppercase tracking-[0.08em]"
      style={{ color: "var(--text-3)", fontWeight: 600 }}
    >
      {children}
    </div>
  );
}

export function BigTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="mb-3 mt-1.5"
      style={{
        fontFamily: "var(--serif)",
        fontSize: 30,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        lineHeight: 1.1,
      }}
    >
      {children}
    </h1>
  );
}

export function Question({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-[18px]"
      style={{
        fontFamily: "var(--serif)",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1.2,
      }}
    >
      {children}
    </h2>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 mt-[18px] text-[11px] uppercase tracking-[0.08em]"
      style={{ color: "var(--text-2)", fontWeight: 600 }}
    >
      {children}
    </div>
  );
}

export function SummaryRow({
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
      className="flex justify-between py-3.5 text-[14px]"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span
        className="text-right font-semibold"
        style={{
          color: muted
            ? "var(--text-3)"
            : green
              ? "var(--sobre-accent)"
              : "var(--text-1)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function SignInLink({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-2.5 text-center text-[13px]"
      style={{ color: "var(--text-2)" }}
    >
      {children}
    </div>
  );
}

export function TermsLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-3.5 text-center text-[11px] leading-relaxed"
      style={{ color: "var(--text-3)" }}
    >
      {children}
    </div>
  );
}

export function GoogleCta({
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
      className="inline-flex w-full items-center justify-center gap-3"
      style={{
        background: "var(--surface)",
        color: "var(--text-1)",
        border: "1.5px solid var(--border-strong)",
        borderRadius: 10,
        padding: "13px 16px",
        fontSize: 15,
        fontWeight: 600,
        boxShadow: "var(--shadow-sm)",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "wait" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function GoogleG({ size = 18 }: { size?: number }) {
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
