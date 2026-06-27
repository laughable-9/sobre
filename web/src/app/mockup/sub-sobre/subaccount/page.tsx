"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";

/**
 * Junior's view: stripped-down dashboard for a sub-account. No envelopes,
 * no policy, no member list, no settings. Just the spendable balance, lock
 * state if frozen, and one "Cash out" button that funnels into the
 * existing PDAX cashout flow.
 *
 * Toggle the lock state in the corner to preview what Junior sees when
 * admin has frozen him.
 */
export default function SubAccountMockup() {
  const [locked, setLocked] = useState(false);
  const balance = 2450;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        background: "var(--bg)",
        position: "relative",
      }}
    >
      <PreviewToggle locked={locked} onToggle={() => setLocked((v) => !v)} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 16px 24px",
        }}
      >
        <Hero />

        <div
          style={{
            background: "var(--surface)",
            border: locked
              ? "1.5px solid var(--sobre-danger)"
              : "1px solid var(--border)",
            borderRadius: 18,
            padding: "22px 20px",
            marginTop: 16,
            textAlign: "center",
          }}
        >
          {locked ? (
            <LockedBadge />
          ) : (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 10,
                fontWeight: 700,
                color: "var(--sobre-accent)",
                background: "var(--accent-soft)",
                padding: "3px 9px",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              <ShieldCheck size={10} strokeWidth={2.4} />
              Active
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-3)",
              marginTop: 14,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Your spendable balance
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 42,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              marginTop: 6,
              color: locked ? "var(--text-3)" : "var(--text-1)",
            }}
            className="tabular"
          >
            ₱{balance.toLocaleString("en-PH")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            Topped up by Daddy from Needs · Mon
          </div>

          <button
            type="button"
            disabled={locked}
            className="sobre-btn sobre-btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "14px 16px",
              fontSize: 15,
              fontWeight: 600,
              marginTop: 22,
              opacity: locked ? 0.45 : 1,
              cursor: locked ? "not-allowed" : "pointer",
            }}
          >
            <ArrowUpRight size={16} strokeWidth={2.4} />
            Cash out to BPI
          </button>

          {locked ? (
            <button
              type="button"
              style={{
                width: "100%",
                marginTop: 8,
                padding: "12px 14px",
                background: "transparent",
                border: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-2)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Bell size={14} strokeWidth={2.4} />
              Ask Daddy to unlock
            </button>
          ) : null}
        </div>

        <Activity locked={locked} />
      </div>
    </div>
  );
}

function PreviewToggle({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 5,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-2)",
        background: "var(--surface)",
        border: "1px dashed var(--border)",
        padding: "5px 9px",
        borderRadius: 999,
      }}
      title="Preview toggle, not part of the real UI"
    >
      preview: {locked ? "locked" : "active"} · tap to flip
    </button>
  );
}

function Hero() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          display: "grid",
          placeItems: "center",
          fontSize: 26,
        }}
      >
        🧒
      </div>
      <div>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          Junior's allowance
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginTop: 1,
          }}
        >
          <Wallet size={11} strokeWidth={2.4} />
          Pagunsan Family · sub-account
        </div>
      </div>
    </div>
  );
}

function LockedBadge() {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10,
        fontWeight: 700,
        color: "var(--sobre-danger)",
        background: "#fbe9e6",
        padding: "3px 9px",
        borderRadius: 999,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      <Lock size={10} strokeWidth={2.4} />
      Locked by Daddy
    </div>
  );
}

interface Entry {
  date: string;
  amount: number;
  memo: string;
  kind: "in" | "out";
}

const HISTORY: Entry[] = [
  { date: "Mon", amount: 1000, memo: "Daddy topped up from Needs", kind: "in" },
  { date: "Sun", amount: 350, memo: "Cashed out to BPI", kind: "out" },
  { date: "Sat", amount: 220, memo: "Cashed out to BPI", kind: "out" },
  { date: "Fri", amount: 180, memo: "Cashed out to BPI", kind: "out" },
  { date: "Wed", amount: 2000, memo: "Daddy topped up from Wants", kind: "in" },
];

function Activity({ locked }: { locked: boolean }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h2
        style={{
          fontFamily: "var(--serif)",
          fontSize: 16,
          fontWeight: 600,
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
        }}
      >
        Activity
      </h2>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
        }}
      >
        {HISTORY.map((h, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 14px",
              borderBottom:
                i === HISTORY.length - 1 ? "none" : "1px solid var(--border)",
              opacity: locked && h.kind === "out" ? 0.5 : 1,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{h.memo}</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-3)",
                  marginTop: 2,
                }}
              >
                {h.date}
              </div>
            </div>
            <div
              className="tabular"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color:
                  h.kind === "in" ? "var(--sobre-accent)" : "var(--text-1)",
              }}
            >
              {h.kind === "in" ? "+" : "-"}₱{h.amount.toLocaleString("en-PH")}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        You only see your own balance and what you've spent. The family
        envelopes are private to the admins.
      </p>
    </section>
  );
}
