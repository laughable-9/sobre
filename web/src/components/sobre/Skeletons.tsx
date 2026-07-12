"use client";

/**
 * Skeleton placeholders that mirror the real card shapes so the layout
 * doesn't reflow when the data arrives. Each component matches the visual
 * footprint of its loaded counterpart (SobreCard, EnvelopeCard,
 * ActivityFeed item) so users see structure first, content second.
 */

/** `tone="on-hero"` renders a semi-transparent white bar so skeleton blocks
 *  laid over the green BalanceHero stay visible without the per-instance
 *  background overrides that were littered inline in HomeSkeleton. */
export function SkeletonBlock({
  width,
  height,
  radius = 8,
  tone,
  style,
}: {
  width: number | string;
  height: number | string;
  radius?: number;
  tone?: "on-hero";
  style?: React.CSSProperties;
}) {
  const toneStyle: React.CSSProperties =
    tone === "on-hero"
      ? { background: "rgba(255, 255, 255, 0.28)" }
      : {};
  return (
    <span
      className="sobre-skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        ...toneStyle,
        ...style,
      }}
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

/** Tab this dashboard load is heading to. Passed in from the page so refresh
 *  to /dashboard/<id>#activity shows the Activity skeleton, not the Home one. */
export type DashboardSkeletonTab =
  | "home"
  | "envelopes"
  | "activity"
  | "settings"
  | "subaccounts"
  | "profile";

/** Route to the tab-shaped skeleton so refresh preserves the same layout the
 *  user was looking at. Falls back to home for tabs we haven't specialised. */
export function DashboardSkeleton({
  tab = "home",
}: { tab?: DashboardSkeletonTab } = {}) {
  // maxWidth per tab MUST match the mounted dashboard's per-tab wrapper
  // (see dashboard/[contractId]/page.tsx). Without this the skeleton loads
  // at one width, then snaps to another when state arrives.
  const maxWidth =
    tab === "settings"
      ? 1320
      : tab === "profile"
        ? 480
        : tab === "envelopes" || tab === "activity"
          ? 760
          : 640;
  return (
    <div
      className="mx-auto w-full px-4 sm:px-7 pt-6 pb-12"
      style={{ maxWidth }}
    >
      {tabSkeleton(tab)}
    </div>
  );
}

function tabSkeleton(tab: DashboardSkeletonTab) {
  switch (tab) {
    case "activity":
      return <ActivitySkeleton />;
    case "envelopes":
      return <EnvelopesSkeleton />;
    case "subaccounts":
      return <StackedCardsSkeleton title="Sub-accounts" />;
    case "settings":
      return <StackedCardsSkeleton title="Settings" cards={4} />;
    case "profile":
      return <StackedCardsSkeleton title="Profile" cards={2} narrow />;
    case "home":
    default:
      return <HomeSkeleton />;
  }
}

/** Home tab: green BalanceHero (with 3 envelope split rows inside), Yield
 *  section card, Recent Activity list. */
function HomeSkeleton() {
  return (
    <div className="sobre-wallet-col">
      {/* Green BalanceHero card. Uses the loaded hero's background so the
          user reads "the big card is on its way" instead of "the layout
          just shifted." White skeleton blocks on the green tint. */}
      <section
        className="sobre-v2-hero"
        aria-hidden
        style={{ pointerEvents: "none" }}
      >
        <div className="hero-title-row">
          <SkeletonBlock width={120} height={16} tone="on-hero" />
          <SkeletonBlock width={90} height={30} radius={999} tone="on-hero" />
        </div>
        <div className="label" style={{ marginTop: 20 }}>
          <SkeletonBlock width={90} height={11} tone="on-hero" />
        </div>
        <SkeletonBlock
          width="60%"
          height={44}
          tone="on-hero"
          style={{ marginTop: 8 }}
        />
        <SkeletonBlock
          width="40%"
          height={14}
          tone="on-hero"
          style={{ marginTop: 10 }}
        />
        <div
          className="sobre-v2-split"
          role="list"
          aria-hidden
          style={{ marginTop: 18 }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="sobre-v2-split-row" role="listitem">
              <span className="top">
                <span className="chip">
                  <SkeletonBlock width={16} height={16} radius={4} />
                </span>
                <SkeletonBlock width={90} height={14} />
                <SkeletonBlock
                  width={72}
                  height={14}
                  style={{ marginLeft: "auto" }}
                />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Yield section — same layout the loaded EarnGrowSummary uses. */}
      <section className="sobre-summary-section" aria-hidden>
        <div className="sobre-envs-section-head">
          <SkeletonBlock width={54} height={12} />
          <SkeletonBlock width={54} height={12} />
        </div>
        <div
          className="sobre-summary-card"
          style={{
            padding: 18,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <SkeletonBlock width={44} height={44} radius={999} />
          <div style={{ flex: 1 }}>
            <SkeletonBlock width={110} height={11} />
            <SkeletonBlock
              width="55%"
              height={22}
              style={{ marginTop: 8 }}
            />
            <SkeletonBlock
              width="35%"
              height={12}
              style={{ marginTop: 8 }}
            />
          </div>
          <SkeletonBlock width={92} height={22} radius={999} />
        </div>
      </section>

      {/* Recent activity — matches RecentActivityPreview. */}
      <section className="sobre-recent" aria-hidden>
        <div className="sobre-recent-head">
          <SkeletonBlock width={110} height={13} />
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="sobre-recent-row"
            style={{ pointerEvents: "none" }}
          >
            <span className="ic" style={{ background: "var(--surface-alt)" }}>
              <SkeletonBlock width={14} height={14} radius={4} />
            </span>
            <div className="body">
              <div className="line">
                <SkeletonBlock width="55%" height={14} />
                <SkeletonBlock width={64} height={14} />
              </div>
              <SkeletonBlock
                width={80}
                height={11}
                style={{ marginTop: 6 }}
              />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Activity tab: real "Activity" heading + skeleton rows. The heading is
 *  static per-tab, so skeletonizing it just makes the loading state feel
 *  more broken than "content on its way." Same shape used in the Suspense
 *  fallback, the pre-state-ready render, and the in-panel loading state,
 *  so all three transitions land on identical pixels — no wrapper column
 *  because the mounted ActivityFeed renders the aside directly and adding
 *  a flex-column parent here made rows shrink to intrinsic width. */
function ActivitySkeleton() {
  return (
    <aside className="sobre-activity">
      <div className="head">
        <h3>Activity</h3>
      </div>
      <ActivityRowsSkeleton count={5} />
    </aside>
  );
}

/** Reusable row cluster for the activity feed — used as the empty/loading
 *  fill inside ActivityFeed too, so we don't fall back to a bare
 *  "Loading activity…" line. Row shape mirrors the v2 activity item: a
 *  bordered card with a 40px circular icon/avatar slot and two text
 *  lines (primary who/what + time meta). */
export function ActivityRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="list" aria-hidden>
      <div className="sobre-day">
        <SkeletonBlock width={54} height={11} />
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="sobre-activity-item"
          style={{
            pointerEvents: "none",
            cursor: "default",
            alignItems: "center",
          }}
        >
          <span
            className="ic"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--sobre-surface-alt)",
              display: "block",
              flexShrink: 0,
            }}
          />
          <div className="body" style={{ flex: 1 }}>
            <SkeletonBlock width="65%" height={14} />
            <SkeletonBlock
              width={72}
              height={11}
              style={{ marginTop: 6 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Generic settings/subaccounts/profile fallback: a heading + N card blocks.
 *  Purposefully vague — settings has heterogenous forms, subaccounts renders
 *  a variable member list, profile is one detail card — so the placeholder
 *  reads as "the page is loading" without pretending to know the shape. */
function StackedCardsSkeleton({
  title,
  cards = 3,
  narrow = false,
}: {
  title?: string;
  cards?: number;
  narrow?: boolean;
}) {
  return (
    <div
      className="sobre-wallet-col"
      style={narrow ? { maxWidth: 480, margin: "0 auto" } : undefined}
    >
      {title ? (
        <h2
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {title}
        </h2>
      ) : null}
      <div
        aria-hidden
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 20,
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <SkeletonBlock width="35%" height={16} />
            <SkeletonBlock
              width="60%"
              height={28}
              style={{ marginTop: 12 }}
            />
            <SkeletonBlock
              width="80%"
              height={12}
              style={{ marginTop: 10 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Envelopes tab: real "Envelopes" heading + skeleton envelope cards. Kept
 *  as three cards since the real dashboard is always 3. Same static-title
 *  rule as ActivitySkeleton — the heading is the same string every load. */
function EnvelopesSkeleton() {
  return (
    <div className="sobre-wallet-col">
      <div className="sobre-envs">
        <header className="sobre-envs-header">
          <h2>Envelopes</h2>
        </header>
        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <SkeletonBlock width="100%" height={10} radius={999} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sobre-envelope">
            <div className="row1">
              <SkeletonBlock width={44} height={44} radius={12} />
              <SkeletonBlock width={140} height={19} />
            </div>
            <SkeletonBlock
              width="55%"
              height={40}
              style={{ marginTop: 16 }}
            />
            <SkeletonBlock
              width={140}
              height={13}
              style={{ marginTop: 6 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
