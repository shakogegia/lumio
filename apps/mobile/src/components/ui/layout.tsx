import { type ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, radius, weight } from "../../lib/theme";

/** Full-screen themed spinner for auth/session loading states. */
export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={[styles.flex, styles.center, { backgroundColor: colors.background}]}>
      <ActivityIndicator color={colors.mutedForeground} />
    </View>
  );
}

/** Full-screen grouped-list shell: themed background, safe area, keyboard-aware,
 *  content vertically centered (the auth screens are short forms). */
export function Screen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background}]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/** Gray caption above a grouped card (iOS section header). */
export function SectionHeader({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.section, { color: colors.mutedForeground }]}>{children}</Text>;
}

/** Rounded surface that floats over the grouped background and clips its rows. */
export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

/** Hairline divider between rows, inset from the left like iOS grouped lists. */
export function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.separator, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 32, gap: 28 },
  section: {
    fontSize: 13,
    fontWeight: weight.regular,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginLeft: 16,
    marginBottom: 7,
  },
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
});
