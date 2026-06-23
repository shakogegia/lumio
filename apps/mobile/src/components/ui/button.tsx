import { Pressable, Text, View, StyleSheet, ActivityIndicator } from "react-native";
import { GlassView } from "expo-glass-effect";
import { GLASS } from "../../lib/glass";
import { useTheme, radius, weight } from "../../lib/theme";

/** Primary call-to-action. On iOS 26 it's a tinted Liquid Glass capsule; elsewhere
 *  a solid primary pill (matching the web's rounded-4xl primary button). */
export function Button({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const inner = loading ? (
    <ActivityIndicator color={colors.primaryForeground} />
  ) : (
    <Text style={[styles.label, { color: colors.primaryForeground }]}>{label}</Text>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.pressable,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive tintColor={colors.primary} style={styles.capsule}>
          {inner}
        </GlassView>
      ) : (
        <View style={[styles.capsule, { backgroundColor: colors.primary }]}>{inner}</View>
      )}
    </Pressable>
  );
}

/** Quiet secondary action rendered as a centered text link (e.g. "Change server"). */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
      <Text style={[styles.link, { color: colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: radius.pill },
  capsule: {
    height: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  label: { fontSize: 17, fontWeight: weight.semibold },
  link: { fontSize: 15, fontWeight: weight.medium, textAlign: "center" },
  pressed: { opacity: 0.8, transform: [{ translateY: 1 }] },
  disabled: { opacity: 0.45 },
});
