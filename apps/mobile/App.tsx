import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from "@expo-google-fonts/fraunces";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { RootNavigator } from "./src/navigation/RootNavigator";
import { Splash } from "./src/components/Splash";
import { PhpRateBoot } from "./src/lib/usePhpPerXlm";
import { colors } from "./src/theme/tokens";

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });
  const [splashDone, setSplashDone] = useState(false);

  // Hold the app off-screen until fonts are ready so the splash wordmark and
  // the screens behind it render in the right typeface from the first frame.
  if (!fontsLoaded) return null;

  return (
    <View style={styles.root}>
      <PhpRateBoot />
      <RootNavigator />
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
