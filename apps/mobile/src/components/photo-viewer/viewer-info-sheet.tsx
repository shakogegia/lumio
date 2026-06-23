import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PhotoDTO } from "@lumio/shared";
import { useTheme } from "@/lib/theme";
import { formatPhotoTitle } from "./viewer-title";

/** Bottom sheet with a photo's metadata (date, dimensions, camera, file). */
export function ViewerInfoSheet({
  photo,
  visible,
  onClose,
}: {
  photo: PhotoDTO | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!photo) return null;

  const { title, subtitle } = formatPhotoTitle(photo);
  const filename = photo.path.split("/").pop() || photo.path;
  const camera = [photo.exif?.cameraMake, photo.exif?.cameraModel].filter(Boolean).join(" ");
  const rows: { label: string; value: string }[] = [
    { label: "Date", value: subtitle ? `${title} · ${subtitle}` : title },
    { label: "Dimensions", value: `${photo.width} × ${photo.height}` },
  ];
  if (camera) rows.push({ label: "Camera", value: camera });
  rows.push({ label: "File", value: filename }, { label: "Path", value: photo.path });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <Text style={[styles.heading, { color: colors.foreground }]}>Info</Text>
        <ScrollView>
          {rows.map((r) => (
            <View key={r.label} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>{r.label}</Text>
              <Text style={[styles.value, { color: colors.foreground }]} selectable>
                {r.value}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "70%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginBottom: 12 },
  heading: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  value: { fontSize: 15 },
});
