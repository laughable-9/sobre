/**
 * In-app launch splash. On first mount it covers the screen with the Sobre
 * logo + wordmark on the cream background, the mark pops in (fade + slight
 * scale), holds briefly, then the whole overlay fades out and calls `onDone`
 * to reveal the app underneath.
 *
 * This is a JS overlay, not the native expo-splash-screen — it lets the mark
 * animate and matches the brand without extra native config.
 */

import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

import { SobreLogo } from "./ui/SobreLogo";
import { rs } from "../theme/responsive";
import { colors } from "../theme/tokens";

const POP_MS = 520;
const HOLD_MS = 650;
const FADE_MS = 380;

export function Splash({ onDone }: { onDone: () => void }) {
  // Mark entrance (0 → 1) and overlay exit (1 → 0) progress.
  const pop = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const seq = Animated.sequence([
      Animated.timing(pop, {
        toValue: 1,
        duration: POP_MS,
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_MS),
      Animated.timing(overlay, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]);
    seq.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => seq.stop();
  }, [pop, overlay, onDone]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, { opacity: overlay }]}
    >
      <Animated.View
        style={{
          opacity: pop,
          transform: [
            {
              scale: pop.interpolate({
                inputRange: [0, 1],
                outputRange: [0.85, 1],
              }),
            },
          ],
        }}
      >
        <SobreLogo size={rs(96)} />
      </Animated.View>
      <Animated.Text style={[styles.wordmark, { opacity: pop }]}>
        Sobre
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    zIndex: 10,
  },
  wordmark: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: rs(28),
    fontWeight: "600",
    color: colors.text1,
  },
});
