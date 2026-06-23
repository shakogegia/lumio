/* eslint-disable react-hooks/immutability, react-hooks/refs --
   react-native-reanimated shared values (useSharedValue) REQUIRE the `.value`
   mutation pattern, in worklets and in gesture/scroll callbacks. The React
   Compiler lint models shared values as immutable hook returns / refs and flags
   every `sv.value = …` and the gesture-built-in-render — these are false
   positives: reanimated 4 is React-Compiler-compatible (its worklets are
   excluded from compilation). Scoped to this one animation-heavy file. */
import {
  type ReactElement,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { FlashList } from "@shopify/flash-list";
import type { PhotoDTO } from "@lumio/shared";
import type { Rect } from "@/lib/rect";
import { PhotoTile } from "./photo-tile";
import { ZOOM_IN_THRESHOLD, ZOOM_OUT_THRESHOLD, stepInColumns } from "./zoom";

export const DEFAULT_ZOOM_LEVELS = [1, 3, 5, 8];

// Empty leading cells injected so the focal photo lands in the same column
// across layouts during a zoom (kept blank, sized like a tile).
type EmptyCell = { type: "empty"; id: string };
type Cell = PhotoDTO | EmptyCell;
const isEmpty = (c: Cell): c is EmptyCell => (c as EmptyCell).type === "empty";

// Per-layout alignment computed at pinch start: how many blank cells to prepend,
// where to scroll, and the padded index of the focal photo.
type LayerConfig = { padding: number; scrollOffset: number; targetIndex: number };
type ConfigMap = Record<number, LayerConfig>;

// Minimal scrollable surface we need from a FlashList ref.
type Scrollable = { scrollToOffset: (p: { offset: number; animated?: boolean }) => void };

/**
 * Reusable iOS-Photos-style grid: square tiles on FlashList with pinch-to-zoom
 * between a fixed set of column counts. Adapted from react-native-zoom-grid: it
 * stacks one FlashList per zoom level and, during a pinch, scales every layer by
 * `scale × (cols / activeCols)` while cross-fading the target layer in and
 * keeping the photo under your fingers anchored — so committing a zoom (animating
 * `scale` to `activeCols / nextCols`, at which point the target layer is already
 * at its natural size) has no visual jump. Renders PhotoTile directly; an album
 * screen reuses it by swapping the data passed in.
 */
export function ZoomablePhotoGrid({
  photos,
  baseURL,
  slug,
  cookie,
  zoomLevels = DEFAULT_ZOOM_LEVELS,
  initialColumns = 3,
  fit = "cover",
  openThreshold = 3,
  onColumnsChange,
  onOpenPhoto,
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
  fit?: "cover" | "contain";
  /** At or below this column count a tap opens the viewer; above it, a tap zooms
   *  one step in. */
  openThreshold?: number;
  onColumnsChange?: (columns: number) => void;
  onOpenPhoto?: (index: number, rect: Rect) => void;
  onEndReached?: () => void;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentInset?: { top: number; bottom: number };
  ListEmptyComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
}) {
  const { width, height } = useWindowDimensions();
  const topInset = contentInset?.top ?? 0;
  const bottomInset = contentInset?.bottom ?? 0;

  const [activeColumns, setActiveColumns] = useState(() =>
    zoomLevels.includes(initialColumns)
      ? initialColumns
      : zoomLevels[Math.floor(zoomLevels.length / 2)],
  );
  const [isPinching, setIsPinching] = useState(false);

  const blankConfig = useMemo<ConfigMap>(() => {
    const c: ConfigMap = {};
    zoomLevels.forEach((cols) => (c[cols] = { padding: 0, scrollOffset: 0, targetIndex: 0 }));
    return c;
  }, [zoomLevels]);
  const [layerConfig, setLayerConfig] = useState<ConfigMap>(blankConfig);
  const layerConfigRef = useRef(layerConfig);
  useLayoutEffect(() => {
    layerConfigRef.current = layerConfig;
  }, [layerConfig]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const activeScrollOffset = useSharedValue(0);
  const activeColsShared = useSharedValue(activeColumns);
  useLayoutEffect(() => {
    activeColsShared.value = activeColumns;
  }, [activeColumns, activeColsShared]);

  const listRefs = useRef<Record<number, Scrollable | null>>({});
  const setListRef = useCallback((cols: number, ref: Scrollable | null) => {
    listRefs.current[cols] = ref;
  }, []);

  // For a focal photo, the leading blank-cell count + scroll offset that place it
  // in the same on-screen column/row under the finger in a `targetCols` layout.
  const calculateLayerConfig = useCallback(
    (dataIndex: number, targetCols: number, fX: number, fY: number): LayerConfig => {
      const targetSize = width / targetCols;
      const idealCol = Math.floor(fX / targetSize);
      const clampedCol = Math.max(0, Math.min(idealCol, targetCols - 1));
      const currentMod = dataIndex % targetCols;
      const padding = (clampedCol - currentMod + targetCols) % targetCols;

      const paddedIndex = dataIndex + padding;
      const targetRow = Math.floor(paddedIndex / targetCols);
      const targetItemCenterY = targetRow * targetSize + targetSize / 2 + topInset;
      const targetScroll = targetItemCenterY - fY;

      const totalRows = Math.ceil((photos.length + padding) / targetCols);
      const contentHeight = totalRows * targetSize + topInset + bottomInset;
      const maxScroll = Math.max(0, contentHeight - height);
      return {
        padding,
        scrollOffset: Math.max(0, Math.min(targetScroll, maxScroll)),
        targetIndex: paddedIndex,
      };
    },
    [width, height, topInset, bottomInset, photos.length],
  );

  // At pinch start, find the photo under the finger and pre-align every other
  // layer to it (scroll them so the cross-fade lands on the same photo).
  const prepareZoom = useCallback(
    (fX: number, fY: number) => {
      const currentCols = activeColumns;
      const currentScroll = activeScrollOffset.value;
      const currentSize = width / currentCols;
      const currentPadding = layerConfigRef.current[currentCols]?.padding ?? 0;

      const gridY = fY + currentScroll - topInset;
      const row = Math.floor(gridY / currentSize);
      const col = Math.floor(fX / currentSize);
      const dataIndex = row * currentCols + col - currentPadding;
      if (dataIndex < 0 || dataIndex >= photos.length) return;

      const next: ConfigMap = {};
      zoomLevels.forEach((cols) => {
        next[cols] = calculateLayerConfig(dataIndex, cols, fX, fY);
      });
      layerConfigRef.current = { ...layerConfigRef.current, ...next };
      setLayerConfig((prev) => ({ ...prev, ...next }));

      // Lists must exist (mounted) before we can scroll them — defer a tick.
      setTimeout(() => {
        zoomLevels.forEach((cols) => {
          const offset = cols === currentCols ? currentScroll : next[cols].scrollOffset;
          listRefs.current[cols]?.scrollToOffset({ offset, animated: false });
        });
      }, 0);
    },
    [
      activeColumns,
      activeScrollOffset,
      width,
      topInset,
      photos.length,
      zoomLevels,
      calculateLayerConfig,
    ],
  );

  const handleZoomFinish = useCallback(
    (nextCols: number) => {
      const cfg = layerConfigRef.current[nextCols];
      if (cfg) activeScrollOffset.value = cfg.scrollOffset;
      activeColsShared.value = nextCols;
      savedScale.value = 1;
      scale.value = 1;
      setActiveColumns(nextCols);
      onColumnsChange?.(nextCols);
    },
    [activeScrollOffset, activeColsShared, savedScale, scale, onColumnsChange],
  );

  // Tap a tile: at a dense zoom, step one level in (focal-anchored on the tile,
  // reusing the pinch commit path); at openThreshold or below, open the viewer.
  const handleTilePress = useCallback(
    (index: number, rect: Rect) => {
      if (activeColumns > openThreshold) {
        const nextCols = stepInColumns(zoomLevels, activeColumns);
        if (nextCols === activeColumns) return;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        focalX.value = cx;
        focalY.value = cy;
        savedScale.value = 1;
        scale.value = 1;
        prepareZoom(cx, cy);
        scale.value = withTiming(activeColumns / nextCols, { duration: 250 }, (finished) => {
          if (finished) runOnJS(handleZoomFinish)(nextCols);
        });
      } else {
        onOpenPhoto?.(index, rect);
      }
    },
    [
      activeColumns,
      openThreshold,
      zoomLevels,
      focalX,
      focalY,
      savedScale,
      scale,
      prepareZoom,
      handleZoomFinish,
      onOpenPhoto,
    ],
  );

  // Inline gesture (recreated each render) so onEnd reads the current
  // activeColumns. onStart/onUpdate/onEnd are reanimated worklets (UI thread);
  // only the JS handoffs use runOnJS.
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      savedScale.value = scale.value;
      focalX.value = e.focalX;
      focalY.value = e.focalY;
      runOnJS(setIsPinching)(true);
      runOnJS(prepareZoom)(e.focalX, e.focalY);
    })
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      runOnJS(setIsPinching)(false);
      const s = scale.value;
      const i = zoomLevels.indexOf(activeColumns);
      let nextCols = activeColumns;
      if (i !== -1) {
        if (s >= ZOOM_IN_THRESHOLD && i > 0) nextCols = zoomLevels[i - 1];
        else if (s <= ZOOM_OUT_THRESHOLD && i < zoomLevels.length - 1) nextCols = zoomLevels[i + 1];
      }
      const targetScale = nextCols !== activeColumns ? activeColumns / nextCols : 1;
      scale.value = withTiming(targetScale, { duration: 250 }, (finished) => {
        if (!finished) return;
        if (nextCols !== activeColumns) runOnJS(handleZoomFinish)(nextCols);
        else scale.value = withTiming(1, { duration: 150 });
      });
    });

  const onActiveScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      activeScrollOffset.value = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    },
    [activeScrollOffset, onScroll],
  );

  return (
    <GestureDetector gesture={pinch}>
      <View style={styles.container}>
        {zoomLevels.map((cols) => (
          <GridLayer
            key={cols}
            cols={cols}
            isActive={cols === activeColumns}
            isPinching={isPinching}
            photos={photos}
            baseURL={baseURL}
            slug={slug}
            cookie={cookie}
            config={layerConfig[cols] ?? blankConfig[cols]}
            layerConfig={layerConfig}
            activeColumns={activeColumns}
            width={width}
            height={height}
            topInset={topInset}
            bottomInset={bottomInset}
            scale={scale}
            activeColsShared={activeColsShared}
            focalX={focalX}
            focalY={focalY}
            activeScrollOffset={activeScrollOffset}
            setListRef={setListRef}
            onActiveScroll={onActiveScroll}
            onEndReached={onEndReached}
            fit={fit}
            onTilePress={cols === activeColumns ? handleTilePress : undefined}
            ListEmptyComponent={ListEmptyComponent}
            ListFooterComponent={ListFooterComponent}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

const GridLayer = memo(function GridLayer({
  cols,
  isActive,
  isPinching,
  photos,
  baseURL,
  slug,
  cookie,
  config,
  layerConfig,
  activeColumns,
  width,
  height,
  topInset,
  bottomInset,
  scale,
  activeColsShared,
  focalX,
  focalY,
  activeScrollOffset,
  setListRef,
  onActiveScroll,
  onEndReached,
  fit,
  onTilePress,
  ListEmptyComponent,
  ListFooterComponent,
}: {
  cols: number;
  isActive: boolean;
  isPinching: boolean;
  photos: PhotoDTO[];
  baseURL: string;
  slug: string;
  cookie: string;
  config: LayerConfig;
  layerConfig: ConfigMap;
  activeColumns: number;
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  scale: SharedValue<number>;
  activeColsShared: SharedValue<number>;
  focalX: SharedValue<number>;
  focalY: SharedValue<number>;
  activeScrollOffset: SharedValue<number>;
  setListRef: (cols: number, ref: Scrollable | null) => void;
  onActiveScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  fit: "cover" | "contain";
  onTilePress?: (index: number, rect: Rect) => void;
  ListEmptyComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
}) {
  const data = useMemo<Cell[]>(() => {
    if (config.padding === 0) return photos;
    const pad: EmptyCell[] = Array.from({ length: config.padding }, (_, i) => ({
      type: "empty",
      id: `pad-${cols}-${i}`,
    }));
    return [...pad, ...photos];
  }, [photos, config.padding, cols]);

  // Scales this layer by `scale × (cols/activeCols)` and translates so the focal
  // photo (config.targetIndex) stays anchored to the active layer's focal photo
  // — the three terms anchor around the gesture focal point and screen center.
  const animatedStyle = useAnimatedStyle(() => {
    const s = scale.value;
    const activeCols = activeColsShared.value;
    const relativeScale = s * (cols / activeCols);

    let opacity = 0;
    let zIndex = 0;
    if (cols === activeCols) {
      zIndex = 10;
      opacity = s < 1 ? interpolate(s, [1, 0.66], [1, 0], Extrapolation.CLAMP) : 1;
    } else if (cols < activeCols) {
      // Zoom-in target (fewer columns) fades in as you pinch out past 1.
      if (s > 1) {
        zIndex = 20;
        opacity = interpolate(s, [1, activeCols / cols], [0, 1], Extrapolation.CLAMP);
      }
    } else if (s < 1) {
      // Zoom-out target (more columns) shows beneath as you pinch in.
      zIndex = 5;
      opacity = 1;
    }

    const centerX = width / 2;
    const centerY = height / 2;

    const activeCfg = layerConfig[activeCols] ?? { padding: 0, scrollOffset: 0, targetIndex: 0 };
    const activeSize = width / activeCols;
    const aIdx = activeCfg.targetIndex;
    const posAx = (aIdx % activeCols) * activeSize;
    const posAy = Math.floor(aIdx / activeCols) * activeSize + topInset - activeScrollOffset.value;

    const thisSize = width / cols;
    const tIdx = config.targetIndex;
    const thisScroll = isActive ? activeScrollOffset.value : config.scrollOffset;
    const posBx = (tIdx % cols) * thisSize;
    const posBy = Math.floor(tIdx / cols) * thisSize + topInset - thisScroll;

    const tx = (posAx - centerX) * s + (focalX.value - centerX) * (1 - s) - (posBx - centerX) * relativeScale;
    const ty = (posAy - centerY) * s + (focalY.value - centerY) * (1 - s) - (posBy - centerY) * relativeScale;

    return {
      opacity,
      zIndex,
      transform: [{ translateX: tx }, { translateY: ty }, { scale: relativeScale }],
    };
  }, [config, layerConfig, activeColumns, cols, width, height, topInset, isActive]);

  const interactive = isActive && !isPinching;

  return (
    <Animated.View style={[styles.layer, { width, height }, animatedStyle]} pointerEvents={interactive ? "auto" : "none"}>
      <FlashList
        ref={(r: Scrollable | null) => setListRef(cols, r)}
        data={data}
        numColumns={cols}
        scrollEnabled={interactive}
        keyExtractor={(item: Cell, index: number) => (isEmpty(item) ? `empty-${cols}-${index}` : item.id)}
        renderItem={({ item, index }: { item: Cell; index: number }) =>
          isEmpty(item) ? (
            <View style={styles.emptyCell} />
          ) : (
            <PhotoTile
              photo={item}
              baseURL={baseURL}
              slug={slug}
              cookie={cookie}
              fit={fit}
              // `data` prepends config.padding blank cells, so the photo's real
              // index is the list index minus that padding.
              onPress={onTilePress ? (rect) => onTilePress(index - config.padding, rect) : undefined}
            />
          )
        }
        onScroll={isActive ? onActiveScroll : undefined}
        scrollEventThrottle={16}
        onEndReached={isActive ? onEndReached : undefined}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset }}
        ListEmptyComponent={isActive ? ListEmptyComponent : undefined}
        ListFooterComponent={isActive ? ListFooterComponent : undefined}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  layer: { position: "absolute", top: 0, left: 0 },
  emptyCell: { flex: 1, aspectRatio: 1, padding: 1 },
});
