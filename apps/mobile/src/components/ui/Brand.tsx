/**
 * Sobre wordmark — the logo mark plus the name, mirroring the web's
 * "logo + Sobre" pairing (web/src/components/sobre/TopBar.tsx).
 */

import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/tokens";
import { SobreLogo } from "./SobreLogo";

export function Brand({ size = 28 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <SobreLogo size={size} />
      <Text style={styles.name}>Sobre</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontFamily: "Fraunces_600SemiBold",
    fontSize: 20,
    fontWeight: "600",
    color: colors.text1,
  },
});
