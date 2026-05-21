"use client";

/**
 * Skeleton placeholders that mirror the real card shapes so the layout
 * doesn't reflow when the data arrives. Each component matches the visual
 * footprint of its loaded counterpart (SobreCard, SummaryCard, EnvelopeCard,
 * ActivityFeed item) so users see structure first, content second.
 */

export function SkeletonBlock({
  width,
  height,
  radius = 8,
  style,
}: {
  width: number | string;
  height: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="sobre-skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function SobreCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 20,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start gap-3 mb-4">
        <SkeletonBlock width={44} height={44} radius={12} />
        <div className="flex-1 min-w-0">
          <SkeletonBlock width="60%" height={18} />
          <SkeletonBlock
            width={56}
            height={14}
            radius={999}
            style={{ marginTop: 8 }}
          />
        </div>
      </div>
      <div
        className="mb-3"
        style={{
          background: "var(--surface-alt)",
          borderRadius: 10,
          padding: 12,
        }}
      >
        <SkeletonBlock width={80} height={10} />
        <SkeletonBlock width="70%" height={22} style={{ marginTop: 8 }} />
        <SkeletonBlock width={64} height={11} style={{ marginTop: 6 }} />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBlock width={22} height={22} radius={999} />
        <SkeletonBlock width={22} height={22} radius={999} />
        <SkeletonBlock width="40%" height={12} />
      </div>
    </div>
  );
}

/** Mirrors the 3-column main grid: summary | envelopes | activity. */
export function DashboardSkeleton() {
  return (
    <div className="sobre-dash">
      <aside className="sobre-summary">
        <div className="sobre-summary-card">
          <SkeletonBlock width={80} height={10} />
          <SkeletonBlock
            width="70%"
            height={44}
            style={{ marginTop: 12 }}
          />
          <SkeletonBlock width="40%" height={14} style={{ marginTop: 10 }} />
          <SkeletonBlock
            width="100%"
            height={42}
            radius={8}
            style={{ marginTop: 16 }}
          />
          <div
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: 22,
              paddingTop: 18,
            }}
          >
            <SkeletonBlock width={100} height={10} />
            <div
              className="flex items-center gap-3"
              style={{ marginTop: 12 }}
            >
              <SkeletonBlock width={32} height={32} radius={999} />
              <div className="flex-1">
                <SkeletonBlock width="50%" height={14} />
                <SkeletonBlock
                  width="40%"
                  height={11}
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="sobre-envs">
        <div className="mb-5">
          <SkeletonBlock width={140} height={22} />
          <SkeletonBlock width="60%" height={13} style={{ marginTop: 6 }} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sobre-envelope">
            <div className="row1">
              <SkeletonBlock width={44} height={44} radius={12} />
              <SkeletonBlock width={120} height={19} />
            </div>
            <SkeletonBlock
              width="50%"
              height={40}
              style={{ marginTop: 16 }}
            />
            <SkeletonBlock
              width={120}
              height={13}
              style={{ marginTop: 6 }}
            />
          </div>
        ))}
      </div>

      <aside className="sobre-activity">
        <div className="head">
          <SkeletonBlock width={90} height={18} />
        </div>
        <div className="list">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 12, padding: "12px 4px" }}
            >
              <SkeletonBlock width={32} height={32} radius={999} />
              <div style={{ flex: 1 }}>
                <SkeletonBlock width="80%" height={14} />
                <SkeletonBlock
                  width="50%"
                  height={11}
                  style={{ marginTop: 6 }}
                />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
