"use client";

import {
  BabyIcon,
  CarIcon,
  DeviceMobileIcon,
  DotsThreeCircleIcon,
  ForkKnifeIcon,
  GameControllerIcon,
  GiftIcon,
  GraduationCapIcon,
  HeartbeatIcon,
  HouseIcon,
  LightningIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  UserIcon,
  type Icon,
} from "@phosphor-icons/react";

import type { ExpenseCategoryKey } from "@/lib/expenseCategories";

const ICON_MAP: Record<ExpenseCategoryKey, Icon> = {
  Dining: ForkKnifeIcon,
  Groceries: ShoppingCartIcon,
  Transportation: CarIcon,
  School: GraduationCapIcon,
  Kids: BabyIcon,
  Health: HeartbeatIcon,
  Utilities: LightningIcon,
  Bills: ReceiptIcon,
  Load: DeviceMobileIcon,
  Housing: HouseIcon,
  Personal: UserIcon,
  Entertainment: GameControllerIcon,
  Gifts: GiftIcon,
  Other: DotsThreeCircleIcon,
};

/** Render the Phosphor icon that represents an expense category. Falls back
 *  to the "Other" glyph when an unknown key sneaks in from older rows. */
export function ExpenseCategoryIcon({
  category,
  size = 20,
  weight = "regular",
}: {
  category: string;
  size?: number;
  weight?: "regular" | "bold" | "fill" | "duotone";
}) {
  const Comp = ICON_MAP[category as ExpenseCategoryKey] ?? DotsThreeCircleIcon;
  return <Comp size={size} weight={weight} />;
}
