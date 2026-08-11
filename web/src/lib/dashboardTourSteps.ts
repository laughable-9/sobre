import type { DashboardSkeletonTab } from "@/components/sobre/Skeletons";

/**
 * Tabs the tour can request via `requiresTab`. Same set of surfaces the
 * dashboard itself navigates to (dock tabs + the settings sub-view),
 * imported straight from the dashboard's own tab type so a new tab
 * there is immediately available here without a parallel definition.
 */
export type TourTab = DashboardSkeletonTab;

/**
 * One step of the in-app dashboard tour. The tour walks this array in
 * order, spotlighting the DOM element with `[data-tour="{anchor}"]` and
 * showing the callout next to it.
 *
 * Editing rules:
 *   • Add a new tab to the dock: tag it with `data-tour="dock-<name>"`
 *     and append a step here. No other file needs to change.
 *   • Reorder the tour: reorder this array.
 *   • Feature moved to a different tab: change `requiresTab`.
 *   • Admin-only feature: set `requiresRole: "admin"` (skipped for
 *     members and supplementary holders).
 *   • Full-screen card (no spotlight, no anchor): omit `anchor`.
 *   • Anchor missing at runtime (unmounted, hidden): the tour skips
 *     the step and logs a warning; it will not crash.
 */
export type TourRole = "admin";

export type TourStep = {
  /** Stable id for React keys and debug logs. Parents can watch step ids
   *  via `onStepChange` to fire side effects (open a sheet, etc.). */
  id: string;
  /** Value of the `data-tour` attribute on the DOM element to spotlight.
   *  Omit for a full-screen centered card (welcome / farewell / "here's
   *  the whole page"). */
  anchor?: string;
  title: string;
  body: string;
  /** Preferred callout side. The component falls back to whatever side has
   *  space if the preferred one would clip off-screen. Default is "auto".
   *  For anchor-less cards: "top" pins the card near the top of the
   *  viewport so an already-open sheet/modal stays visible below it. */
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  /** Auto-switch to this dashboard tab before showing the step. */
  requiresTab?: TourTab;
  /** Skip this step unless the caller has this role. */
  requiresRole?: TourRole;
  /** Extra padding (px) around the highlighted element in the cutout.
   *  Default 8. Bump for tiny targets (icon-only buttons). */
  padding?: number;
  /** Anchor-less steps only. Default true = soft dim scrim behind the
   *  card. Set false when the parent opens another overlay (sheet, modal)
   *  during this step and dimming would obscure it. A transparent
   *  click-catcher renders instead so the parent overlay stays visible. */
  dimmed?: boolean;
};

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: "balance",
    anchor: "balance-hero",
    title: "Your family total",
    body: "The live balance both of you see, in PHP. Tap the currency chip to switch to USD.",
    placement: "bottom",
    requiresTab: "home",
  },
  {
    id: "split",
    anchor: "envelope-split",
    title: "Money splits itself",
    body: "Every deposit is split across these envelopes by the % your admin set. Nobody has to move it manually.",
    placement: "top",
    requiresTab: "home",
  },
  {
    id: "envelopes-tab",
    anchor: "dock-envelopes",
    title: "Envelopes tab",
    body: "See each envelope on its own, change names, and adjust the split.",
    placement: "top",
  },
  {
    id: "envelope-card",
    anchor: "envelope-card-first",
    title: "Tap any envelope",
    body: "Cash out, send to a family member, or move money between envelopes.",
    placement: "top",
    requiresTab: "envelopes",
  },
  {
    id: "settings-gear",
    anchor: "envelopes-settings-gear",
    title: "Household rules",
    body: "As admin, tap this gear to edit the split %, change envelope names, invite more admins, or close the wallet.",
    placement: "bottom",
    requiresTab: "envelopes",
    requiresRole: "admin",
    padding: 6,
  },
  {
    // No anchor. The settings surface is too tall to spotlight. Renders
    // as a centered popup while the settings page is visible behind it.
    id: "settings-panel",
    title: "Everything about the wallet",
    body: "This is your settings page. Household policy, envelope names and split, admin cap, contract upgrades, and closing the wallet all live here.",
    requiresTab: "settings",
    requiresRole: "admin",
  },
  {
    id: "open-sobre",
    anchor: "dock-open-sobre",
    title: "The Sobre button",
    body: "The centre button opens your Sobre. Every money action starts here.",
    placement: "top",
  },
  {
    // The dashboard opens the OpenSobreSheet when this step activates
    // (see the parent's onStepChange handler). Anchor is inside the
    // sheet so the tour spotlights the real tiles and the callout
    // lands right above them.
    id: "open-sobre-features",
    anchor: "sobre-sheet-actions",
    title: "What's inside",
    body: "Add money, cash out, send to a family member, or log a household expense.",
    placement: "top",
  },
  {
    id: "activity",
    anchor: "dock-activity",
    title: "Activity",
    body: "Every move, who did it, and when. Nothing hidden from either of you.",
    placement: "top",
  },
  {
    id: "activity-expenses",
    anchor: "activity-expenses-tab",
    title: "Expenses view",
    body: "Switch to Expenses to see spending grouped by envelope and category. A running picture of where the money went.",
    placement: "bottom",
    requiresTab: "activity",
  },
  {
    id: "profile",
    anchor: "dock-profile",
    title: "Your account",
    body: "Invite family, add your bank account, and switch between your Sobres. You can also replay this tour from here anytime.",
    placement: "top",
  },
  {
    id: "welcome",
    title: "Welcome to Sobre",
    body: "That's the tour. You can replay it anytime from your profile. Enjoy your Sobre.",
  },
];
