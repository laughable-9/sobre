"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ClockCounterClockwiseIcon,
  EnvelopeIcon,
  EnvelopeSimpleIcon,
  HouseIcon,
  UserIcon,
} from "@phosphor-icons/react";

export type DockTab = "home" | "envelopes" | "activity" | "profile";

/**
 * Mobile-first bottom navigation. Four content tabs bookend a raised center
 * "Sobre" tile — tapping the center opens an action sheet ("open the
 * envelope"). Sticks to the safe-area bottom on mobile; centered with a
 * max-width on desktop.
 */
export function BottomDock({
  active,
  onTab,
  onOpenSobre,
}: {
  active: DockTab;
  onTab: (tab: DockTab) => void;
  /** Fires when the center Sobre tile is tapped. Renders the action sheet. */
  onOpenSobre: () => void;
}) {
  return (
    <nav className="sobre-dock" aria-label="Primary">
      <div className="sobre-dock-inner">
        <DockTabBtn
          label="Home"
          active={active === "home"}
          onClick={() => onTab("home")}
          Icon={HouseIcon}
        />
        <DockTabBtn
          label="Envelopes"
          active={active === "envelopes"}
          onClick={() => onTab("envelopes")}
          Icon={EnvelopeIcon}
        />

        <button
          type="button"
          onClick={onOpenSobre}
          className="sobre-dock-fab"
          aria-label="Open wallet actions"
        >
          <EnvelopeSimpleIcon weight="fill" size={26} />
        </button>

        <DockTabBtn
          label="Activity"
          active={active === "activity"}
          onClick={() => onTab("activity")}
          Icon={ClockCounterClockwiseIcon}
        />
        <DockTabBtn
          label="User"
          active={active === "profile"}
          onClick={() => onTab("profile")}
          Icon={UserIcon}
        />
      </div>
    </nav>
  );
}

function DockTabBtn({
  label,
  active,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  Icon: PhosphorIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sobre-dock-tab"
      data-active={active}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={22} weight={active ? "fill" : "regular"} />
      <span>{label}</span>
    </button>
  );
}
