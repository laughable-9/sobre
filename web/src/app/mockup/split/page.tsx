"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  GraduationCap,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Sprout,
  TrendingUp,
  Zap,
} from "lucide-react";

/**
 * Split mockup: a stand-in for the real /dashboard at mobile viewport. Uses
 * the same .sobre-summary-card / .sobre-envelope / .sobre-pill / .sobre-btn
 * classes as the live app so the visual treatment is identical, only the
 * data is faked. Tap the bottom button to flip from baseline to post-split
 * state so the audience sees envelope balances move and the activity feed
 * gain two new entries.
 */
export default function SplitMockup() {
  const [fired, setFired] = useState(false);

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
        <SummaryCard fired={fired} />
        <EnvelopesList fired={fired} />
        <ActivitySection fired={fired} />
      </div>
      <div
        style={{
          padding: "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))",
          background: "var(--bg)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={() => setFired((v) => !v)}
          className="sobre-btn sobre-btn-primary"
          style={{
            width: "100%",
            justifyContent: "center",
            padding: "13px 16px",
            fontSize: 14,
          }}
        >
          <Zap size={16} strokeWidth={2.4} />
          {fired ? "Reset demo" : "Trigger ₱30,000 deposit"}
        </button>
      </div>
    </div>
  );
}

function SummaryCard({ fired }: { fired: boolean }) {
  const totalWhole = fired ? "76,856" : "46,856";
  return (
    <aside className="sobre-summary">
      <div className="sobre-summary-card">
        <span className="sobre-label">Total balance</span>
        <div className="sobre-total">
          ₱ {totalWhole}
          <span className="cents">.90</span>
        </div>
        <div
          className="flex items-center gap-2 mt-3 text-[13px]"
          style={{ color: "var(--text-2)" }}
        >
          <span className="tabular">
            {fired ? "$1,369.46" : "$835.16"} USDC
          </span>
          <span
            className="w-[3px] h-[3px] rounded-full"
            style={{ background: "var(--text-3)" }}
          />
          <span>4 envelopes</span>
        </div>

        <button
          type="button"
          className="sobre-btn sobre-btn-primary mt-4 w-full justify-center"
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          <Plus size={16} strokeWidth={2} />
          Add a remittance
        </button>

        <div className="sobre-members">
          <div className="flex items-center justify-between">
            <span className="sobre-label">Members (3)</span>
          </div>
          <div className="mt-3 space-y-1">
            <MemberRow
              initials="MR"
              name="Maria"
              role="Admin · Hong Kong"
              palette={{ bg: "#fbe7d2", fg: "#D67E28" }}
              you
            />
            <MemberRow
              initials="JL"
              name="Joel"
              role="Admin · Manila"
              palette={{ bg: "#E8F0EA", fg: "#2E6B4C" }}
            />
            <MemberRow
              initials="LL"
              name="Lola Edna"
              role="Recipient"
              palette={{ bg: "#F4EDDC", fg: "#6B5F50" }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function MemberRow({
  initials,
  name,
  role,
  palette,
  you,
}: {
  initials: string;
  name: string;
  role: string;
  palette: { bg: string; fg: string };
  you?: boolean;
}) {
  return (
    <div className="sobre-member">
      <div
        className="av"
        style={{
          background: palette.bg,
          color: palette.fg,
          fontSize: 12,
        }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="name">
          {name}
          {you ? (
            <span
              className="ml-2 text-[11px]"
              style={{ color: "var(--sobre-accent)" }}
            >
              you
            </span>
          ) : null}
        </div>
        <div className="role">{role}</div>
      </div>
    </div>
  );
}

function EnvelopesList({ fired }: { fired: boolean }) {
  return (
    <section style={{ marginTop: 16 }}>
      <h2
        style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          fontWeight: 600,
          margin: "0 0 4px",
          letterSpacing: "-0.01em",
        }}
      >
        Envelopes
      </h2>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
        4 envelopes · split 40 / 25 / 20 / 15
      </div>
      <Envelope
        icon={<ShoppingCart size={20} strokeWidth={2} />}
        name="Daily needs"
        pct={40}
        whole={fired ? "30,720" : "18,720"}
        delta={fired ? "+₱12,000" : null}
        pulse={fired}
      />
      <Envelope
        icon={<GraduationCap size={20} strokeWidth={2} />}
        name="Bills & utilities"
        pct={25}
        whole={fired ? "19,200" : "11,700"}
        delta={fired ? "+₱7,500" : null}
        pulse={fired}
      />
      <Envelope
        icon={<ShoppingBag size={20} strokeWidth={2} />}
        name="Kids"
        pct={20}
        whole={fired ? "15,360" : "9,360"}
        delta={fired ? "+₱6,000" : null}
        pulse={fired}
      />
      <Envelope
        icon={<Sprout size={20} strokeWidth={2} />}
        name="Savings"
        pct={15}
        whole={fired ? "11,576" : "7,076"}
        delta={fired ? "+₱4,500" : null}
        pulse={fired}
        savings
      />
    </section>
  );
}

function Envelope({
  icon,
  name,
  pct,
  whole,
  delta,
  pulse,
  savings,
}: {
  icon: React.ReactNode;
  name: string;
  pct: number;
  whole: string;
  delta: string | null;
  pulse: boolean;
  savings?: boolean;
}) {
  return (
    <div
      className={[
        "sobre-envelope",
        savings ? "green-env" : "",
        pulse ? "pulse" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="row1">
        <div className="ic">{icon}</div>
        <h3>{name}</h3>
        <div className="meta-right">
          {savings ? (
            <span className="sobre-pill sobre-pill-soft-green">
              <TrendingUp size={12} strokeWidth={2} />
              4.65% APY
            </span>
          ) : null}
          <span className="sobre-pill sobre-pill-cream">{pct}% split</span>
        </div>
      </div>

      <div className="sobre-env-amount">
        ₱ {whole}
        <span style={{ fontSize: 18, color: "var(--text-2)" }}>.90</span>
      </div>

      <div className="sobre-env-usdc tabular">
        {pct}% of every deposit
        {delta ? (
          <span
            style={{
              marginLeft: 8,
              color: "var(--sobre-accent)",
              fontWeight: 600,
            }}
          >
            {delta}
          </span>
        ) : null}
      </div>

      <div className="sobre-env-foot" style={{ justifyContent: "flex-end" }}>
        <button className="sobre-btn sobre-btn-primary">Spend</button>
      </div>
    </div>
  );
}

function ActivitySection({ fired }: { fired: boolean }) {
  return (
    <aside className="sobre-activity" style={{ marginTop: 16 }}>
      <div className="head">
        <h3>Activity</h3>
      </div>
      <div className="list">
        {fired && (
          <>
            <div className="sobre-day">Today</div>
            <div className="sobre-activity-item inflow new">
              <div className="ic">
                <ArrowDownToLine size={16} strokeWidth={2} />
              </div>
              <div className="body">
                <div className="who">
                  Remittance received{" "}
                  <span className="amt tabular">+ ₱ 30,000.00</span>
                </div>
                <div className="where">
                  Auto-split · D ₱12,000 · B ₱7,500 · K ₱6,000 · S ₱4,500
                </div>
                <div className="meta">just now</div>
              </div>
            </div>
          </>
        )}
        <div className="sobre-day">Yesterday</div>
        <div className="sobre-activity-item outflow">
          <div className="ic">
            <ShoppingBag size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              Joel spent <span className="amt tabular">₱ 2,400.00</span> from
              Daily needs
            </div>
            <div className="where">&quot;groceries SM&quot;</div>
            <div className="meta">4:12 PM</div>
          </div>
        </div>
        <div className="sobre-activity-item outflow">
          <div className="ic">
            <ShoppingBag size={16} strokeWidth={2} />
          </div>
          <div className="body">
            <div className="who">
              Lola spent <span className="amt tabular">₱ 350.00</span> from her
              sub-account
            </div>
            <div className="where">&quot;mercury gamot&quot;</div>
            <div className="meta">2:08 PM</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
