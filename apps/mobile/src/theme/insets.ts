/**
 * Status-bar / notch top inset, computed without react-native-safe-area-context.
 *
 * `react-native`'s SafeAreaView doesn't apply a top inset on Android (and is
 * unreliable in Expo Go), so screens that draw their own top chrome pad by this
 * instead: the real status-bar height on Android, a notch-safe fallback on iOS.
 */

import { Platform, StatusBar } from "react-native";

export const TOP_INSET =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 48;
