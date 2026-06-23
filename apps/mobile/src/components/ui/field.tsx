import { type ReactNode } from "react";
import { View, Text, TextInput, StyleSheet, Switch, type TextInputProps } from "react-native";
import { useTheme, weight } from "../../lib/theme";

/** A text-entry row inside a Card: optional leading prefix and trailing accessory
 *  flank a flex TextInput. */
export function FieldRow({
  prefix,
  trailing,
  style,
  ...inputProps
}: TextInputProps & { prefix?: ReactNode; trailing?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {prefix}
      <TextInput
        style={[styles.input, { color: colors.foreground }, style]}
        placeholderTextColor={colors.mutedForeground}
        {...inputProps}
      />
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

/** Non-editable URL scheme shown flush against the host input (e.g. `https://`). */
export function InputPrefix({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.prefix, { color: colors.mutedForeground }]}>{children}</Text>;
}

/** Red circular "!" validation marker (matches the iOS form-error affordance). */
export function ErrorBadge() {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
      <Text style={styles.badgeMark}>!</Text>
    </View>
  );
}

/** Label + toggle row inside a Card. */
export function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, styles.switchRow]}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

/** Native switch with the theme accent as the on-tint (black in light, white in
 *  dark). The iOS thumb is always white and can't be recolored — `thumbColor`
 *  only applies on Android. */
function Toggle({ value, onValueChange }: { value: boolean; onValueChange: (value: boolean) => void }) {
  const { colors, scheme } = useTheme();
  const trackOff = scheme === "dark" ? "#39393D" : "#E9E9EA";
  return (
    <View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: trackOff, true: colors.primary }}
      thumbColor={colors.primaryForeground}
      ios_backgroundColor={trackOff}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" },
  switchRow: { justifyContent: "space-between" },
  // Stretch to fill the row height with no own vertical padding, so the text
  // centers on the row's true middle (and the whole row stays tappable) instead
  // of the input's padding box skewing it.
  input: { flex: 1, alignSelf: "stretch", fontSize: 17, paddingVertical: 0, textAlignVertical: "center" },
  prefix: { fontSize: 17 },
  label: { fontSize: 17, fontWeight: weight.regular },
  trailing: { marginLeft: 8 },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badgeMark: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", lineHeight: 15 },
});
