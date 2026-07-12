import type { EnvelopeName } from "@/lib/config";
import {
  AirplaneIcon,
  BarbellIcon,
  BookOpenIcon,
  ForkKnifeIcon,
  GiftIcon,
  GraduationCapIcon,
  HeartIcon,
  HouseIcon,
  PawPrintIcon,
  PlantIcon,
  ShoppingCartIcon,
  BusIcon,
} from "@phosphor-icons/react";

/**
 * Curated icon set families can pick from for each of their envelopes.
 * Keyed by short slug so the value stored in family_envelope_names.icon
 * stays readable in DB tools. `render()` returns the icon element at the
 * requested size; component-authored so each icon can size independently.
 */
export interface EnvelopeIconOption {
  key: string;
  label: string;
  render: (size: number) => React.ReactNode;
}

export const ENVELOPE_ICON_OPTIONS: readonly EnvelopeIconOption[] = [
  { key: "cart", label: "Groceries", render: (s) => <ShoppingCartIcon weight="fill" size={s} /> },
  { key: "cap", label: "Tuition", render: (s) => <GraduationCapIcon weight="fill" size={s} /> },
  { key: "plant", label: "Savings", render: (s) => <PlantIcon weight="fill" size={s} /> },
  { key: "house", label: "Home", render: (s) => <HouseIcon weight="fill" size={s} /> },
  { key: "fork", label: "Dining", render: (s) => <ForkKnifeIcon weight="fill" size={s} /> },
  { key: "bus", label: "Transport", render: (s) => <BusIcon weight="fill" size={s} /> },
  { key: "heart", label: "Health", render: (s) => <HeartIcon weight="fill" size={s} /> },
  { key: "airplane", label: "Travel", render: (s) => <AirplaneIcon weight="fill" size={s} /> },
  { key: "gift", label: "Gifts", render: (s) => <GiftIcon weight="fill" size={s} /> },
  { key: "barbell", label: "Fitness", render: (s) => <BarbellIcon weight="fill" size={s} /> },
  { key: "book", label: "Books", render: (s) => <BookOpenIcon weight="fill" size={s} /> },
  { key: "paw", label: "Pets", render: (s) => <PawPrintIcon weight="fill" size={s} /> },
];

const OPTION_BY_KEY = new Map(ENVELOPE_ICON_OPTIONS.map((o) => [o.key, o]));

/** Default icon key per canonical slot. Used when a family hasn't picked
 *  a custom icon yet (family_envelope_names.icon is null). */
export const DEFAULT_ICON_KEY_BY_SLOT: Record<EnvelopeName, string> = {
  Groceries: "cart",
  Tuition: "cap",
  Savings: "plant",
};

export function renderEnvelopeIcon(
  key: string | null | undefined,
  slot: EnvelopeName,
  size: number,
): React.ReactNode {
  const chosen =
    (key ? OPTION_BY_KEY.get(key) : undefined) ??
    OPTION_BY_KEY.get(DEFAULT_ICON_KEY_BY_SLOT[slot]);
  return chosen ? chosen.render(size) : null;
}

export function iconKeyOrDefault(
  key: string | null | undefined,
  slot: EnvelopeName,
): string {
  if (key && OPTION_BY_KEY.has(key)) return key;
  return DEFAULT_ICON_KEY_BY_SLOT[slot];
}
