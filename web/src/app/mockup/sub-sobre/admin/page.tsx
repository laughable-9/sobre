"use client";

import { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Lock,
  LockOpen,
  Send,
  ShoppingCart,
  Sprout,
  X,
} from "lucide-react";

/**
 * Admin view mockup with the new "Sub-accounts" panel. Shows the existing
 * envelopes (cropped to keep the scroll short) plus the new card that lets
 * admin send money from any envelope to a sub-account, lock/unlock, and
 * peek at the sub-account's spend history.
 *
 * Standalone — no real contract calls, no real Supabase. Tap-friendly,
 * mobile-first.
 */

interface SubAccount {
  id: string;
  name: string;
  emoji: string;
  balance: number;
  locked: boolean;
  history: { date: string; amount: number; memo: string }[];
}

const INITIAL_SUBS: SubAccount[] = [
  {
    id: "junior",
    name: "Junior",
    emoji: "🧒",
    balance: 2450,
    locked: false,
    history: [
      { date: "Mon", amount: 350, memo: "Cashed out to BPI · school baon" },
      { date: "Sat", amount: 220, memo: "Cashed out to BPI · merienda" },
      { date: "Fri", amount: 180, memo: "Cashed out to BPI · jeep" },
    ],
  },
  {
    id: "ate",
    name: "Ate Bea",
    emoji: "🎓",
    balance: 8200,
    locked: true,
    history: [
      { date: "Wed", amount: 5000, memo: "Cashed out to BPI · tuition" },
      { date: "Tue", amount: 600, memo: "Cashed out to BPI · books" },
    ],
  },
];

export default function AdminSubSobreMockup() {
  const [subs, setSubs] = useState<SubAccount[]>(INITIAL_SUBS);
  const [sendTarget, setSendTarget] = useState<SubAccount | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleLock = (id: string) =>
    setSubs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, locked: !s.locked } : s)),
    );
  const handleSend = (target: SubAccount, fromEnvelope: string, amount: number) => {
    setSubs((prev) =>
      prev.map((s) =>
        s.id === target.id
          ? {
              ...s,
              balance: s.balance + amount,
              history: [
                {
                  date: "now",
                  amount,
                  memo: `Topped up from ${fromEnvelope}`,
                },
                ...s.history,
              ],
            }
          : s,
      ),
    );
    setSendTarget(null);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        background: "var(--bg)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 24px" }}>
        <SummaryStrip />
        <EnvelopesStrip />

        <section style={{ marginTop: 22 }}>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: 18,
              fontWeight: 600,
              margin: "0 0 4px",
              letterSpacing: "-0.01em",
            }}
          >
            Sub-accounts
          </h2>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              margin: "0 0 12px",
            }}
          >
            Top up from any envelope. Lock to freeze their spending instantly.
          </p>

          {subs.map((s) => (
            <SubCard
              key={s.id}
              sub={s}
              expanded={expandedId === s.id}
              onSend={() => setSendTarget(s)}
              onToggleLock={() => toggleLock(s.id)}
              onToggleExpand={() =>
                setExpandedId((cur) => (cur === s.id ? null : s.id))
              }
            />
          ))}
        </section>
      </div>

      {sendTarget ? (
        <SendModal
          target={sendTarget}
          onClose={() => setSendTarget(null)}
          onConfirm={handleSend}
        />
      ) : null}
    </div>
  );
}

function SummaryStrip() {
  return (
    <aside className="sobre-summary">
      <div className="sobre-summary-card">
        <span className="sobre-label">Total balance</span>
        <div className="sobre-total">
          ₱ 46,856<span className="cents">.90</span>
        </div>
        <div
          className="flex items-center gap-2 mt-3 text-[13px]"
          style={{ color: "var(--text-2)" }}
        >
          <span>Pagunsan Family</span>
          <span
            className="w-[3px] h-[3px] rounded-full"
            style={{ background: "var(--text-3)" }}
          />
          <span>3 envelopes · 2 sub-accounts</span>
        </div>
      </div>
    </aside>
  );
}

function EnvelopesStrip() {
  return (
    <section style={{ marginTop: 16 }}>
      <h2
        style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          fontWeight: 600,
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
        }}
      >
        Envelopes
      </h2>
      <EnvelopeRow
        icon={<ShoppingCart size={18} />}
        name="Needs"
        amount="18,720"
        pct={50}
      />
      <EnvelopeRow
        icon={<GraduationCap size={18} />}
        name="Wants"
        amount="11,700"
        pct={30}
      />
      <EnvelopeRow
        icon={<Sprout size={18} />}
        name="Savings"
        amount="16,436"
        pct={20}
      />
    </section>
  );
}

function EnvelopeRow({
  icon,
  name,
  amount,
  pct,
}: {
  icon: React.ReactNode;
  name: string;
  amount: string;
  pct: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--accent-soft)",
          color: "var(--sobre-accent)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{pct}% split</div>
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
        className="tabular"
      >
        ₱{amount}
      </div>
    </div>
  );
}

function SubCard({
  sub,
  expanded,
  onSend,
  onToggleLock,
  onToggleExpand,
}: {
  sub: SubAccount;
  expanded: boolean;
  onSend: () => void;
  onToggleLock: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              display: "grid",
              placeItems: "center",
              fontSize: 22,
            }}
          >
            {sub.emoji}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {sub.name}
              {sub.locked ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--sobre-danger)",
                    background: "#fbe9e6",
                    padding: "2px 7px",
                    borderRadius: 999,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  <Lock size={10} strokeWidth={2.4} />
                  Locked
                </span>
              ) : null}
            </div>
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: 22,
                fontWeight: 600,
                marginTop: 2,
                letterSpacing: "-0.01em",
              }}
              className="tabular"
            >
              ₱{sub.balance.toLocaleString("en-PH")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              Spendable balance
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
            marginTop: 12,
          }}
        >
          <button
            type="button"
            onClick={onSend}
            className="sobre-btn sobre-btn-primary"
            style={{
              justifyContent: "center",
              padding: "10px 8px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Send size={12} strokeWidth={2.4} />
            Send
          </button>
          <button
            type="button"
            onClick={onToggleLock}
            className="sobre-btn sobre-btn-soft"
            style={{
              justifyContent: "center",
              padding: "10px 8px",
              fontSize: 12,
              fontWeight: 600,
              color: sub.locked
                ? "var(--sobre-accent)"
                : "var(--sobre-danger)",
            }}
          >
            {sub.locked ? (
              <>
                <LockOpen size={12} strokeWidth={2.4} />
                Unlock
              </>
            ) : (
              <>
                <Lock size={12} strokeWidth={2.4} />
                Lock
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            className="sobre-btn sobre-btn-soft"
            style={{
              justifyContent: "center",
              padding: "10px 8px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Activity size={12} strokeWidth={2.4} />
            History
            {expanded ? (
              <ChevronUp size={12} strokeWidth={2.4} />
            ) : (
              <ChevronDown size={12} strokeWidth={2.4} />
            )}
          </button>
        </div>
      </div>

      {expanded ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            padding: "12px 16px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 8,
            }}
          >
            Recent activity
          </div>
          {sub.history.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              Nothing yet.
            </div>
          ) : (
            sub.history.map((h, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                  fontSize: 12,
                  borderBottom:
                    i === sub.history.length - 1
                      ? "none"
                      : "1px dashed var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{h.memo}</div>
                  <div style={{ color: "var(--text-3)", fontSize: 11 }}>
                    {h.date}
                  </div>
                </div>
                <div
                  className="tabular"
                  style={{
                    fontWeight: 600,
                    color: h.memo.startsWith("Topped up")
                      ? "var(--sobre-accent)"
                      : "var(--text-1)",
                  }}
                >
                  {h.memo.startsWith("Topped up") ? "+" : "-"}₱
                  {h.amount.toLocaleString("en-PH")}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function SendModal({
  target,
  onClose,
  onConfirm,
}: {
  target: SubAccount;
  onClose: () => void;
  onConfirm: (target: SubAccount, fromEnvelope: string, amount: number) => void;
}) {
  const [envelope, setEnvelope] = useState<"Needs" | "Wants" | "Savings">(
    "Needs",
  );
  const [amount, setAmount] = useState<string>("500");
  const parsed = Number(amount);
  const ok = parsed > 0 && Number.isFinite(parsed);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(33, 24, 13, 0.45)",
        display: "grid",
        placeItems: "end center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          width: "100%",
          maxWidth: 520,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          padding: "20px 22px calc(22px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Send to {target.name} {target.emoji}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "transparent",
              display: "grid",
              placeItems: "center",
              color: "var(--text-2)",
            }}
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-3)",
            marginBottom: 6,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          From envelope
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["Needs", "Wants", "Savings"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEnvelope(e)}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background:
                  envelope === e ? "var(--sobre-primary)" : "var(--surface)",
                color: envelope === e ? "#fff" : "var(--text-1)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-3)",
            marginBottom: 6,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Amount
        </div>
        <div className="sobre-input-wrap" style={{ marginBottom: 18 }}>
          <span className="prefix">₱</span>
          <input
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="sobre-input has-prefix"
            style={{ fontSize: 16 }}
          />
        </div>

        <button
          type="button"
          onClick={() => ok && onConfirm(target, envelope, parsed)}
          disabled={!ok}
          className="sobre-btn sobre-btn-primary"
          style={{
            width: "100%",
            justifyContent: "center",
            padding: "14px 16px",
            fontSize: 15,
            opacity: ok ? 1 : 0.5,
          }}
        >
          Send ₱{ok ? parsed.toLocaleString("en-PH") : "—"} from {envelope}
        </button>
      </div>
    </div>
  );
}
