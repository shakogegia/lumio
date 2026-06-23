import { type ReactElement, useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { PhotoDTO } from "@lumio/shared";
import { PhotoTile } from "./photo-tile";
import { nextZoomLevel } from "./zoom";

export const DEFAULT_ZOOM_LEVELS = [1, 3, 5, 8];

/**
 * Reusable iOS-Photos-style grid: square tiles on FlashList with pinch-to-zoom
 * between a fixed set of column counts. Renders PhotoTile directly (photos and
 * albums both show photos). Infinite scroll is driven by the parent via
 * onEndReached. The header overlay is the parent's concern — pass its onScroll
 * and a contentInset for top/bottom padding.
 */
export function ZoomablePhotoGrid({
  photos,
  baseURL,
  slug,
  cookie,
  zoomLevels = DEFAULT_ZOOM_LEVELS,
  initialColumns = 3,
  onColumnsChange,
  onEndReached,
  onScroll,
  contentInset,
  ListEmptyComponent,
  ListFooterComponent,
}: {
  photos: PhotoDTO[];
  baseURL: string;
  slug: string;
  cookie: string;
  zoomLevels?: number[];
  initialColumns?: number;
  onColumnsChange?: (columns: number) => void;
  onEndReached?: () => void;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentInset?: { top: number; bottom: number };
  ListEmptyComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
}) {
  // Snap initialColumns onto a provided level; fall back to the middle level.
  const [columns, setColumns] = useState(() =>
    zoomLevels.includes(initialColumns)
      ? initialColumns
      : zoomLevels[Math.floor(zoomLevels.length / 2)],
  );

  // Reads the current `columns` via closure (recreated whenever it changes), so
  // no ref is needed. Called only from the pinch gesture's onEnd (an event).
  const commitZoom = useCallback(
    (finalScale: number) => {
      const idx = zoomLevels.indexOf(columns);
      if (idx < 0) return;
      const next = zoomLevels[nextZoomLevel(zoomLevels, idx, finalScale)];
      if (next !== columns) {
        setColumns(next);
        onColumnsChange?.(next);
      }
    },
    [columns, zoomLevels, onColumnsChange],
  );

  // Pinch callbacks run on the JS thread (runOnJS) so commitZoom can setState
  // directly. We snap on gesture end based on the accumulated scale. Memoized so
  // GestureDetector only re-registers when commitZoom changes (i.e. on a zoom).
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onEnd((e) => commitZoom(e.scale)),
    [commitZoom],
  );

  const renderItem = useCallback(
    ({ item }: { item: PhotoDTO }) => (
      <PhotoTile photo={item} baseURL={baseURL} slug={slug} cookie={cookie} />
    ),
    [baseURL, slug, cookie],
  );

  return (
    <GestureDetector gesture={pinch}>
      <View style={styles.flex}>
        <FlashList
          data={photos}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          contentContainerStyle={
            contentInset
              ? { paddingTop: contentInset.top, paddingBottom: contentInset.bottom }
              : undefined
          }
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
