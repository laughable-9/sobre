/**
 * Mobile landing — the web marketing sections, dressed as an app.
 *
 * We keep the full web pitch (stats, how-it-works, trust, two-sides, final CTA,
 * footer) so nothing of the story is lost, but wrap it in app-first chrome:
 *  - a sticky top bar (brand + settings) pinned above the scroll, clear of the
 *    status bar / notch via TOP_INSET;
 *  - a hero that leads with the product (the ₱10,000 SplitCard), not a wall of
 *    copy;
 *  - a sticky bottom CTA bar so "Open a Sobre" is always one thumb-tap away
 *    while the page scrolls.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Settings } from "lucide-react-native";

import {
  FinalCTA,
  Footer,
  HowItWorks,
  ProblemStats,
  Trust,
  TwoSides,
} from "../components/landing";
import { SplitCard } from "../components/landing/SplitCard";
import { Brand } from "../components/ui/Brand";
import { CtaButton } from "../components/ui/CtaButton";
import { TOP_INSET } from "../theme/insets";
import { rs } from "../theme/responsive";
import { colors } from "../theme/tokens";

export function Landing({ onOpenSobre }: { onOpenSobre: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: TOP_INSET + 8 }]}>
        <Brand />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={10}
          style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
        >
          <Settings size={20} strokeWidth={2} color={colors.text2} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.headline}>
            One Sobre.{"\n"}No matter the{" "}
            <Text style={styles.accent}>distance.</Text>
          </Text>
          <Text style={styles.sub}>
            The joint account for Filipino families. Money you send home
            auto-splits into envelopes the moment it arrives.
          </Text>
          <SplitCard />
        </View>

        <ProblemStats />
        <HowItWorks />
        <Trust />
        <TwoSides />
        <FinalCTA onOpenSobre={onOpenSobre} />
        <Footer />
      </ScrollView>

      <View style={styles.ctaBar}>
        <CtaButton label="Open a Sobre" onPress={onOpenSobre} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  pressed: {
    opacity: 0.6,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 16,
  },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 36,
    gap: 16,
  },
  headline: {
    fontFamily: "Fraunces_700Bold",
    fontSize: rs(38),
    lineHeight: rs(44),
    fontWeight: "700",
    color: colors.text1,
  },
  accent: {
    fontFamily: "Fraunces_700Bold",
    fontStyle: "italic",
    color: colors.primary,
  },
  sub: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text2,
  },
  ctaBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
