/**
 * Marketing copy for the landing page, mirrored from web/src/app/page.tsx.
 * Kept as plain data so the section components stay presentational and the
 * copy is easy to edit in one place.
 */

import type { ComponentType } from "react";
import { DollarSign, Eye, Shield } from "lucide-react-native";

export interface Stat {
  num: string;
  /** Optional "in 10" / "in 5" suffix rendered smaller after the number. */
  sub?: string;
  desc: string;
}

export const STATS: Stat[] = [
  {
    num: "$35.6B",
    desc: "yearly remittances from OFWs — yet most families struggle to save.",
  },
  {
    num: "8",
    sub: "in 10",
    desc: "OFWs return home with no savings after years of working abroad.",
  },
  {
    num: "96%",
    desc: "of remittances are consumed by food and other basic needs.",
  },
  {
    num: "1",
    sub: "in 5",
    desc: "OFW families run out of money before the next remittance arrives.",
  },
];

export const STAT_SOURCES =
  "Sources: BSP, GMA News, Rappler, Ateneo Policy Brief 2020";

export interface Step {
  num: number;
  fil: string;
  body: string;
}

export const STEPS: Step[] = [
  {
    num: 1,
    fil: "Open a Sobre.",
    body: "Open a shared wallet from your phone in under 60 seconds. Invite your family with a link.",
  },
  {
    num: 2,
    fil: "Set the split.",
    body: "Three envelopes: Groceries, Tuition, Savings. Pick the percentages. ₱10,000 becomes ₱5,000 / ₱3,000 / ₱2,000 automatically.",
  },
  {
    num: 3,
    fil: "Send. Split. Done.",
    body: "The moment a deposit lands on Stellar, Sobre splits it across the envelopes. Both sides see it instantly.",
  },
  {
    num: 4,
    fil: "Every peso has a place.",
    body: "Set a daily limit. Lock specific envelopes so big spends need admin approval. Savings earns interest while it sits.",
  },
];

export interface TrustPoint {
  Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
}

export const TRUST: TrustPoint[] = [
  {
    Icon: Shield,
    title: "Built on Stellar",
    body: "Your wallet is a smart contract on Stellar. No bank in the middle.",
  },
  {
    Icon: Eye,
    title: "Verifiable on-chain",
    body: "Every deposit, spend, and approval is a public transaction.",
  },
  {
    Icon: DollarSign,
    title: "Fractions of a cent",
    body: "Stellar charges micro-fees per transaction. Sobre adds zero.",
  },
];

export const SENDER_POINTS = [
  "See where every peso goes, in real time.",
  "No more panic calls asking for extra money.",
  "Set the split once. Sobre handles it forever.",
  "Sleep better knowing nothing falls through the cracks.",
];

export const FAMILY_POINTS = [
  "No fighting over who spent what.",
  "Big purchases need admin approval, so there's no impulse spending.",
  "Real-time visibility into the whole wallet.",
  "Savings grows automatically while you focus on family.",
];
