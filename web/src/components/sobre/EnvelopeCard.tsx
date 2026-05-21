"use client";

import { GraduationCap, ShoppingCart, Sprout, TrendingUp } from "lucide-react";

import { ENVELOPE_LABELS, PHP_PER_XLM, STROOPS_PER_XLM, type EnvelopeName } from "@/lib/config";
import { AnimatedNumber } from "@/components/sobre/AnimatedNumber";

const ICON_BY_NAME: Record<EnvelopeName, React.ReactNode> = {
  Groceries: <ShoppingCart size={20} strokeWidth={2} />,
  Tuition: <GraduationCap size={20} strokeWidth={2} />,
  Savings: <Sprout size={20} strokeWidth={2} />,
};

export function EnvelopeCard({
  index,
  balanceStroops,
  percent,
  pulsing,
  onSpend,
}: {
  index: number;
  balanceStroops: bigint;
  percent: number;
  pulsing: boolean;
  onSpend: () => void;
}) {
  const name = ENVELOPE_LABELS[index];
  const xlm = Number(balanceStroops) / STROOPS_PER_XLM;
  const php = xlm * PHP_PER_XLM;
  const isSavings = name === "Savings";
  const isEmpty = balanceStroops === 0n;

  return (
    <div
      className={[
        "sobre-envelope",
        isSavings ? "green-env" : "",
        pulsing ? "pulse" : "",
        isEmpty ? "empty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="row1">
        <div className="ic">{ICON_BY_NAME[name]}</div>
        <h3>{name}</h3>
        <div className="meta-right">
          {isSavings ? (
            <span className="sobre-pill sobre-pill-soft-green">
              <TrendingUp size={12} strokeWidth={2} />
              4.5% APY
            </span>
          ) : null}
          <span className="sobre-pill sobre-pill-cream">{percent}% split</span>
        </div>
      </div>

      <div className="sobre-env-amount">
        <AnimatedNumber
          value={php}
          format={(n) => {
            const whole = Math.floor(n).toLocaleString("en-PH");
            const cents = Math.abs(n).toFixed(2).split(".")[1];
            return (
              <>
                ₱ {whole}
                <span style={{ fontSize: 24, color: "var(--text-2)" }}>
                  .{cents}
                </span>
              </>
            );
          }}
        />
      </div>

      <div className="sobre-env-usdc tabular">{xlm.toFixed(4)} XLM</div>

      <div
        className="sobre-env-foot"
        style={{ marginTop: 18, justifyContent: "flex-end" }}
      >
        <button
          className="sobre-btn sobre-btn-primary"
          onClick={onSpend}
          disabled={isEmpty}
          style={isEmpty ? { opacity: 0.5, cursor: "not-allowed" } : {}}
        >
          Spend
        </button>
      </div>
    </div>
  );
}
