/**
 * Minimal two-screen navigator (Landing ↔ Dashboard) backed by local state.
 * Deliberately not pulling in a navigation library yet — there are only two
 * screens and no deep-linking/auth flow. Swap this for expo-router or
 * react-navigation once the app grows a wallet-connect flow and more routes.
 */

import { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";

import { Dashboard } from "../screens/Dashboard";
import { Landing } from "../screens/Landing";
import { colors } from "../theme/tokens";
import { TOP_INSET } from "../theme/insets";

type Screen = "landing" | "dashboard";

export function RootNavigator() {
  const [screen, setScreen] = useState<Screen>("landing");

  if (screen === "landing") {
    return (
      <SafeAreaView style={styles.safe}>
        <Landing onOpenSobre={() => setScreen("dashboard")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.topBar, { paddingTop: TOP_INSET + 8 }]}>
        <Pressable
          onPress={() => setScreen("landing")}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
        >
          <ChevronLeft size={20} strokeWidth={2} color={colors.text1} />
          <Text style={styles.backText}>Home</Text>
        </Pressable>
      </View>
      {/* No wallet-connect flow yet (see docs/tech-stack-architecture.md) */}
      <Dashboard address={null} contractId={null} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  pressed: {
    opacity: 0.6,
  },
  backText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text1,
  },
});
