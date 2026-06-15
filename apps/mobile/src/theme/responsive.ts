/**
 * Width-based responsive scaling, no dependency.
 *
 * RN's flex/gap/percentage layout already reflows to any screen — use those for
 * structure. This helper is only for the handful of *large* type sizes that
 * would clip on a small phone or look tiny on a big one (hero headline, balance,
 * stat numbers, splash logo). Leave icon tiles, dots, and bar thicknesses as
 * fixed px — a 6px dot should be 6px everywhere.
 *
 * `rs` scales a size toward the device's width ratio, but only partway (`factor`,
 * default 0.5) so a Pro Max / tablet doesn't blow the headline up to absurd
 * sizes, and a small phone shrinks gracefully. Clamped to a sane band.
 */

import { Dimensions, PixelRatio } from "react-native";

/** iPhone 14 logical width — the size everything was hand-tuned against. */
const BASELINE_WIDTH = 390;

const { width } = Dimensions.get("window");
const ratio = width / BASELINE_WIDTH;

export function rs(size: number, factor = 0.5): number {
  // Clamp the ratio so very small / very large devices don't over-scale.
  const clamped = Math.min(1.3, Math.max(0.85, ratio));
  const scaled = size + (clamped - 1) * size * factor;
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
}
