import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { GlassView } from "expo-glass-effect";
import { GLASS } from "@/lib/glass";
import { useHeaderScrolled } from "@/components/large-header";
import { useTheme } from "@/lib/theme";

/**
 * Header glass button that toggles the grid thumbnails between cover (square
 * crop) and contain (whole photo, letterboxed) — the iOS Photos aspect toggle.
 * The icon reflects the CURRENT state: filled squares for cover, an aspect-ratio
 * glyph for contain.
 */
export function AspectToggle({
  fit,
  onToggle,
}: {
  fit: "cover" | "contain";
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const scrolled = useHeaderScrolled();
  const iconColor = scrolled ? "#FFFFFF" : colors.foreground;

  const symbol = fit === "cover" ? "square.grid.2x2.fill" : "aspectratio";
  const icon = (
    <SymbolView
      name={symbol}
      size={20}
      tintColor={iconColor}
      fallback={<Text style={[styles.fallback, { color: iconColor }]}>{fit === "cover" ? "▦" : "▭"}</Text>}
    />
  );

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={fit === "cover" ? "Show full photos" : "Show square thumbnails"}
    >
      {GLASS ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={scrolled ? "rgba(0,0,0,0.28)" : undefined}
          style={styles.capsule}
        >
          {icon}
        </GlassView>
      ) : (
        <View style={[styles.capsule, { backgroundColor: scrolled ? "rgba(0,0,0,0.4)" : colors.muted }]}>
          {icon}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsule: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fallback: { fontSize: 18 },
});
