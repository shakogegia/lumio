import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useTheme, weight } from "../lib/theme";

// Transparent aperture glyph (shared brand mark with the web app), recolored per
// theme via expo-image's tintColor — so a single asset works in light and dark.
const MARK = require("../../assets/images/logo-mark.png");

export function Logo({ size = 32, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Image
      source={MARK}
      style={{ width: size, height: size }}
      tintColor={color ?? colors.foreground}
      contentFit="contain"
    />
  );
}

/** Stacked brand lockup (mark + wordmark) shown atop the auth screens. */
export function Brand() {
  const { colors } = useTheme();
  return (
    <View style={styles.brand}>
      <Logo size={48} />
      <Text style={[styles.word, { color: colors.foreground }]}>Lumio</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: "center", gap: 12 },
  word: { fontSize: 24, fontWeight: weight.semibold, letterSpacing: -0.5 },
});
