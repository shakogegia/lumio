import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";

// TEMPORARY dummy content: a 3-column square image grid (random placeholder
// photos) so the tabs have something scrollable to show the header's scroll
// blur. Replace with the real photo/album grid later.
const TILES = Array.from({ length: 30 }, (_, i) => `https://picsum.photos/seed/lumio${i}/400/400`);

export function PhotoGridPlaceholder() {
  return (
    <View style={styles.grid}>
      {TILES.map((uri, i) => (
        <View key={i} style={styles.cell}>
          <Image source={{ uri }} style={styles.image} contentFit="cover" transition={150} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "33.3333%", aspectRatio: 1, padding: 1 },
  image: { flex: 1 },
});
