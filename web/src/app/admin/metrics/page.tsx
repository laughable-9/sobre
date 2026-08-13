"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";

import { PAYMENT_TOKEN_LABEL } from "@/lib/config";
import { useAdminMetrics } from "@/hooks/useAdminMetrics";
import { BackLink } from "@/components/sobre/BackLink";

type Granularity = "day" | "week" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** Monday-start ISO week key (YYYY-MM-DD of that week's Monday), so weeks
 *  bucket consistently regardless of which weekday `day` falls on. */
function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10);
}

/** Bucket for one bar: `start`/`end` are its first/last calendar day (UTC
 *  midnight). `label` is the terse per-bar tick — just day number(s), e.g.
 *  "13" or "10–16" — since the month is shown once via a marker above the
 *  first bar of each month (see `monthMarkerFor`), not repeated on every
 *  bar (which collides once there are 10+ bars). `fullLabel` is always
 *  month-qualified, for places a single date needs to read on its own
 *  (the subtitle, the selected-bar detail line). */
interface Bucket {
  key: string;
  start: Date;
  end: Date;
  label: string;
  fullLabel: string;
  count: number;
}

const MONTH_DAY = { month: "short", day: "numeric" } as const;

function fullBucketLabel(
  start: Date,
  end: Date,
  granularity: Granularity,
): string {
  if (granularity === "month") {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (granularity === "day") {
    return start.toLocaleDateString(undefined, MONTH_DAY);
  }
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const endLabel = sameMonth
    ? String(end.getUTCDate())
    : end.toLocaleDateString(undefined, MONTH_DAY);
  return `${start.toLocaleDateString(undefined, MONTH_DAY)}–${endLabel}`;
}

/** Short month name (+ year if not the current year) to print above the
 *  first bar of each new month — "Aug", or "Jan '27" across a year
 *  boundary. Month view doesn't need this; its own tick already says the
 *  month (see `showMonthMarkers` in BucketBarChart). */
function monthMarkerFor(bucket: Bucket, prev: Bucket | undefined): string | null {
  if (prev && prev.start.getUTCMonth() === bucket.start.getUTCMonth()) {
    return null;
  }
  const thisYear = new Date().getUTCFullYear();
  return bucket.start.getUTCFullYear() === thisYear
    ? bucket.start.toLocaleDateString(undefined, { month: "short" })
    : bucket.start.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

/**
 * Re-buckets the server's full daily series (from the first-ever Sobre to
 * today, uncapped) into day/week/month buckets. Pure client-side
 * aggregation — one Supabase round trip serves all three views. Returns
 * every bucket rather than trimming to a fixed count: the chart scrolls,
 * so history isn't lost as the product grows past what a screen-width of
 * bars can show — see BucketBarChart.
 */
function bucketSeries(
  daily: { day: string; count: number }[],
  granularity: Granularity,
): Bucket[] {
  if (granularity === "day") {
    return daily.map((d) => {
      const start = new Date(`${d.day}T00:00:00Z`);
      return {
        key: d.day,
        start,
        end: start,
        label: String(start.getUTCDate()),
        fullLabel: fullBucketLabel(start, start, granularity),
        count: d.count,
      };
    });
  }
  const keyOf = granularity === "week" ? weekKey : (d: string) => d.slice(0, 7);
  const buckets = new Map<string, number>();
  for (const d of daily) {
    const k = keyOf(d.day);
    buckets.set(k, (buckets.get(k) ?? 0) + d.count);
  }
  const sortedKeys = Array.from(buckets.keys()).sort();
  return sortedKeys.map((k) => {
    if (granularity === "week") {
      const start = new Date(`${k}T00:00:00Z`);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const sameMonth = start.getUTCMonth() === end.getUTCMonth();
      return {
        key: k,
        start,
        end,
        label: sameMonth
          ? `${start.getUTCDate()}–${end.getUTCDate()}`
          : fullBucketLabel(start, end, granularity),
        fullLabel: fullBucketLabel(start, end, granularity),
        count: buckets.get(k) ?? 0,
      };
    }
    const start = new Date(`${k}-01T00:00:00Z`);
    // Last day of that month: day 0 of the following month.
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const fullLabel = fullBucketLabel(start, end, granularity);
    return { key: k, start, end, label: fullLabel, fullLabel, count: buckets.get(k) ?? 0 };
  });
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** activityWindowLedgers → days, given Stellar's ~5s ledger close time
 *  (17,280 ledgers/day). Matches the same conversion useTxFeed's comments
 *  use for its ~100k-ledger / ~7-day backfill window. */
function ledgersToDays(ledgers: number): number {
  return Math.round(ledgers / 17_280);
}

/** vs. the prior period. Plain sign, no stock-ticker arrow glyphs. Null
 *  means "no prior-period data to compare against" — shown as "new" rather
 *  than a misleading 0% or an infinite percentage off a zero base. */
function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="sobre-label" style={{ color: "var(--sobre-accent)" }}>
        new
      </span>
    );
  }
  const rounded = Math.round(pct);
  const isFlat = rounded === 0;
  return (
    <span
      className="sobre-label"
      style={{
        color: isFlat
          ? "var(--text-3)"
          : rounded > 0
            ? "var(--sobre-accent)"
            : "var(--sobre-danger)",
      }}
    >
      {isFlat ? "±0%" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`}
    </span>
  );
}

function StatGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-6">
      <h2 className="sobre-label mb-3">{title}</h2>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns:
            "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor,
  hint,
  badge,
}: {
  label: string;
  value: string;
  /** Defaults to var(--text-1). Reserve this for the rare card where the
   *  sign IS the finding (net flow) — coloring every number the same way
   *  cheapens the signal and reads as generic dashboard-template styling. */
  valueColor?: string;
  hint?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="sobre-card-flat">
      <div className="flex items-start justify-between gap-2">
        <span className="sobre-label">{label}</span>
        {badge}
      </div>
      <div
        className="font-serif tabular mt-1.5"
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: valueColor ?? "var(--text-1)",
        }}
      >
        {value}
      </div>
      {hint ? (
        <p className="mt-1.5" style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.4 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Dependency-free bar chart — a metrics dashboard with a dozen-odd bars
 *  doesn't need a charting library; plain SVG renders faster and has zero
 *  bundle cost. Tap/click a bar to see its value in the breakdown line
 *  below — no hover state, so it works the same on touch as on desktop.
 *  Defaults to the most recent bar selected so the breakdown is never
 *  empty on first render. */
const BAR_GAP_PX = 6;
/** Per-bar width in pixels (not viewBox units) — the chart no longer
 *  squeezes an unbounded bucket count into a fixed-width box. Instead the
 *  SVG grows with the data and the container scrolls, so history isn't
 *  lost as the product accumulates months/years of Sobres.
 *
 * Width has to fit the WIDEST tick label for that granularity, not just a
 * round number — a week bar can read "Jul 27–Aug 2" (~11 chars) and a
 * month bar "August 2026" (~11 chars); a bar narrower than its own label
 * lets the text spill into the neighboring bar and overlap it. */
const BAR_PX_BY_GRANULARITY: Record<Granularity, number> = {
  day: 26,
  week: 64,
  month: 72,
};

function BucketBarChart({
  data,
  granularity,
}: {
  data: Bucket[];
  granularity: Granularity;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const barPx = BAR_PX_BY_GRANULARITY[granularity];

  // Land on the most recent bars by default (scrolled fully right) —
  // whenever `data` changes (granularity switch, refresh), not just on
  // first mount, since a scroll position from a longer view wouldn't make
  // sense carried into a shorter one. Deferred a frame: setting scrollLeft
  // in the same commit as the width change can read a stale scrollWidth
  // before the browser has laid out the just-widened SVG.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (data.every((d) => d.count === 0)) {
    return (
      <p style={{ color: "var(--text-3)", fontSize: 13 }}>No data yet.</p>
    );
  }
  const height = 160;
  // Month view's own tick already IS the month name, so it doesn't need a
  // second marker row above it.
  const showMonthMarkers = granularity !== "month";
  const monthRowHeight = showMonthMarkers ? 12 : 0;
  const dayRowHeight = 16;
  const labelHeight = monthRowHeight + dayRowHeight;
  const width = data.length * (barPx + BAR_GAP_PX);
  const max = Math.max(...data.map((d) => d.count), 1);
  const activeIndex = selected ?? data.length - 1;
  const active = data[activeIndex];

  return (
    <div>
      <div ref={scrollRef} style={{ overflowX: "auto", paddingBottom: 2 }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Sobres created over time"
          style={{ display: "block" }}
        >
          {data.map((d, i) => {
            const barHeight = (d.count / max) * (height - 20 - labelHeight);
            const x = i * (barPx + BAR_GAP_PX);
            const y = height - labelHeight - barHeight;
            const isActive = activeIndex === i;
            const monthMarker = showMonthMarkers ? monthMarkerFor(d, data[i - 1]) : null;
            return (
              <g
                key={d.key}
                role="button"
                tabIndex={0}
                aria-label={`${d.fullLabel}: ${d.count}`}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(i);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                {/* Full-column hit area — bigger tap target than the bar
                    pixels alone, matters most for short/near-zero bars. */}
                <rect
                  x={x}
                  y={0}
                  width={barPx}
                  height={height - labelHeight}
                  fill="transparent"
                />
                <rect
                  x={x}
                  y={y}
                  width={barPx}
                  height={Math.max(barHeight, 1)}
                  rx={2}
                  fill="var(--sobre-accent)"
                  opacity={isActive ? 1 : 0.45}
                />
                <text
                  x={x + barPx / 2}
                  y={height - 3}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isActive ? "var(--text-1)" : "var(--text-3)"}
                >
                  {d.label}
                </text>
                {monthMarker ? (
                  <text
                    x={x}
                    y={height - dayRowHeight - 2}
                    textAnchor="start"
                    fontSize={9}
                    fontWeight={600}
                    fill="var(--text-2)"
                  >
                    {monthMarker}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div
        className="flex items-baseline justify-between mt-2 pt-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>
          {active.fullLabel}
        </span>
        <span
          className="font-serif tabular"
          style={{ fontSize: 20, fontWeight: 600, color: "var(--text-1)" }}
        >
          {active.count.toLocaleString()}{" "}
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-3)" }}>
            Sobres
          </span>
        </span>
      </div>
    </div>
  );
}

export default function AdminMetricsPage() {
  const { metrics, loading, refreshing, error, refresh } = useAdminMetrics();
  const [granularity, setGranularity] = useState<Granularity>("day");

  const chartData = useMemo(
    () =>
      metrics ? bucketSeries(metrics.sobresCreatedByDay, granularity) : [],
    [metrics, granularity],
  );

  return (
    <div className="sobre-app sobre-v2">
      <main
        className="flex-1 mx-auto w-full px-7 py-12"
        style={{ maxWidth: 1100 }}
      >
        <BackLink href="/" className="mb-4" />

        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-[32px] font-semibold">
              Platform metrics
            </h1>
            <p style={{ color: "var(--text-2)", fontSize: 14 }}>
              Internal, admin-only. Not visible to family users.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || (loading && !metrics)}
            className="sobre-btn sobre-btn-soft flex items-center gap-2 shrink-0"
            style={{ padding: "10px 16px", fontSize: 13 }}
          >
            <ArrowClockwiseIcon
              weight="bold"
              size={14}
              className={refreshing ? "animate-spin" : undefined}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {error ? (
          <div
            className="rounded-[10px] p-4 mb-6"
            style={{
              background: "var(--surface-alt)",
              color: "var(--sobre-danger)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        ) : null}

        {loading && !metrics ? (
          <p style={{ color: "var(--text-2)" }}>Loading…</p>
        ) : metrics ? (
          <>
            <StatGroup title="Growth">
              <StatCard
                label="Sobres created"
                value={metrics.sobresCount.toLocaleString()}
                badge={<DeltaBadge pct={metrics.sobresCreatedDeltaPct} />}
                hint={`${metrics.sobresCreatedThisPeriod} in the last ~${ledgersToDays(metrics.activityWindowLedgers)} days, vs ${metrics.sobresCreatedPrevPeriod} the period before`}
              />
              <StatCard
                label="Users / wallets"
                value={metrics.usersCount.toLocaleString()}
              />
              <StatCard
                label="Total value locked"
                value={formatUsd(metrics.tvlUsdc)}
                hint={`${metrics.tvlUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${PAYMENT_TOKEN_LABEL}`}
              />
              <StatCard
                label="Avg. balance / Sobre"
                value={formatUsd(metrics.avgSobreUsdc)}
                hint={`Median: ${formatUsd(metrics.medianSobreUsdc)} (avg. skews toward large Sobres)`}
              />
            </StatGroup>

            <StatGroup title="Engagement">
              <StatCard
                label="Retention"
                value={
                  metrics.matureSobresCount > 0
                    ? `${Math.round((metrics.retentionRate ?? 0) * 100)}%`
                    : "N/A"
                }
                hint={
                  metrics.matureSobresCount > 0
                    ? `${metrics.retainedCount} / ${metrics.matureSobresCount} Sobres older than ~${ledgersToDays(metrics.activityWindowLedgers)} days stayed active${metrics.matureSobresCount < 5 ? " (small sample, treat as noisy)" : ""}`
                    : "No Sobre is old enough yet to measure"
                }
              />
              <StatCard
                label="Active Sobres"
                value={
                  metrics.sobresCount > 0
                    ? `${metrics.activeSobresCount} / ${metrics.sobresCount}`
                    : "0"
                }
                badge={
                  metrics.activityPriorPeriodAvailable ? (
                    <DeltaBadge pct={metrics.activeSobresDeltaPct} />
                  ) : undefined
                }
                hint={
                  metrics.activityPriorPeriodAvailable
                    ? `Any activity in the last ~${ledgersToDays(metrics.activityWindowLedgers)} days, including new signups (was ${metrics.activeSobresPrevCount} the period before)`
                    : `Any activity in the last ~${ledgersToDays(metrics.activityWindowLedgers)} days, including new signups`
                }
              />
            </StatGroup>

            <StatGroup
              title={`Money movement (last ~${ledgersToDays(metrics.activityWindowLedgers)} days, vs. period before)`}
            >
              <StatCard
                label="Money in"
                value={formatUsd(metrics.recentInflowUsdc)}
                badge={
                  metrics.activityPriorPeriodAvailable ? (
                    <DeltaBadge pct={metrics.recentInflowDeltaPct} />
                  ) : undefined
                }
              />
              <StatCard
                label="Money out"
                value={formatUsd(metrics.recentOutflowUsdc)}
                badge={
                  metrics.activityPriorPeriodAvailable ? (
                    <DeltaBadge pct={metrics.recentOutflowDeltaPct} />
                  ) : undefined
                }
              />
              <StatCard
                label="Net flow"
                value={`${metrics.netFlowUsdc >= 0 ? "+" : "−"}${formatUsd(Math.abs(metrics.netFlowUsdc))}`}
                valueColor={
                  metrics.netFlowUsdc >= 0
                    ? "var(--sobre-accent)"
                    : "var(--sobre-danger)"
                }
                hint={`${formatUsd(metrics.recentInflowUsdc + metrics.recentOutflowUsdc)} total moved`}
              />
              <StatCard
                label="Transactions"
                value={metrics.recentTxCount.toLocaleString()}
                badge={
                  metrics.activityPriorPeriodAvailable ? (
                    <DeltaBadge pct={metrics.recentTxCountDeltaPct} />
                  ) : undefined
                }
              />
            </StatGroup>

            <div className="sobre-card-flat">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="font-serif" style={{ fontSize: 17, fontWeight: 600 }}>
                    Sobres created
                  </h2>
                  <p style={{ color: "var(--text-3)", fontSize: 12 }}>
                    {chartData.length > 0
                      ? `${chartData[0].start.toLocaleDateString(undefined, MONTH_DAY)} – ${chartData[chartData.length - 1].end.toLocaleDateString(undefined, MONTH_DAY)}`
                      : "No data yet"}
                  </p>
                </div>
                <div
                  className="flex gap-1 rounded-[8px] p-1"
                  style={{ background: "var(--surface-alt)" }}
                >
                  {GRANULARITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setGranularity(opt.value)}
                      className="rounded-[6px]"
                      style={{
                        padding: "5px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        background:
                          granularity === opt.value
                            ? "var(--surface)"
                            : "transparent",
                        color:
                          granularity === opt.value
                            ? "var(--text-1)"
                            : "var(--text-3)",
                        boxShadow:
                          granularity === opt.value ? "var(--shadow-sm)" : "none",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <BucketBarChart
                key={granularity}
                data={chartData}
                granularity={granularity}
              />
            </div>

            <p
              className="mt-4"
              style={{ color: "var(--text-3)", fontSize: 12 }}
            >
              Updated {new Date(metrics.computedAt).toLocaleTimeString()} ·
              auto-refreshes every 60s
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
