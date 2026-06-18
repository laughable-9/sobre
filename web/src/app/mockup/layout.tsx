import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Mockup chrome: a thin sticky top bar with a back link to the mockup index,
 * sized to render cleanly at Mobile L (425px) and up. The page below is the
 * actual mobile app — no phone-frame illustration, no desktop wrapper.
 */
export default function MockupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href="/mockup"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-2)",
          }}
        >
          <ArrowLeft size={14} strokeWidth={2.4} />
          Mockups
        </Link>
        <span
          style={{
            fontFamily: "var(--serif)",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          Sobre
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--sobre-accent)",
            background: "var(--accent-soft)",
            padding: "3px 8px",
            borderRadius: 999,
          }}
        >
          Demo
        </span>
      </header>
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </main>
    </div>
  );
}
