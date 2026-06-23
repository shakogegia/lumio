/* eslint-disable react-hooks/immutability --
   reanimated shared values require the `.value` mutation pattern in worklets and
   gesture/effect callbacks; the React Compiler lint flags these as false
   positives (see components/photo-grid/zoomable-photo-grid.tsx + [[lumio-react-compiler-lint]]). */
import { useEffect, useState } from "react";
import { FlatList, Modal, StyleSheet, useWindowDimensions } from "react-native";
import { GestureDetector, GestureHandlerRootView, Gesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PhotoDTO } from "@lumio/shared";
import type { Rect } from "@/lib/rect";
import { useTheme } from "@/lib/theme";
import { setFavorite } from "@/lib/photos-api";
import { ViewerPage } from "./viewer-page";
import { ViewerChrome } from "./viewer-chrome";
import { ViewerInfoSheet } from "./viewer-info-sheet";
import { shareOriginal } from "./viewer-actions";
import { shouldLoadMore } from "./pager";
import { collapseToRect } from "./transition";

const DISMISS_THRESHOLD = 110;
const OPEN_MS = 280;

/**
 * Reusable fullscreen photo viewer. Collection-agnostic: pass an ordered
 * `photos` array + an `index` to open at (null = closed), so the Photos tab and
 * a future album screen reuse it with sort intact and paging continued via
 * `onLoadMore`. Rendered as a `Modal` so it covers the native tab bar.
 *
 * The whole viewer is driven by vTx/vTy/vScale (+ bg opacity): open grows it
 * from the tapped tile; swipe-down tracks the finger and shrinks it live, and on
 * release either flies it to the CURRENT photo's grid tile (via onRequestTileRect,
 * which also scrolls the grid there) or springs back. Per-photo zoom lives inside
 * each page (paging + dismiss disable while zoomed).
 */
export function PhotoViewer({
  photos,
  index,
  originRect,
  baseURL,
  slug,
  cookie,
  onClose,
  onLoadMore,
  onRequestTileRect,
}: {
  photos: PhotoDTO[];
  index: number | null;
  originRect: Rect | null;
  baseURL: string;
  slug: string;
  cookie: string;
  onClose: () => void;
  onLoadMore?: () => void;
  /** Scroll the grid so photo `index` is visible and return its tile rect, so
   *  close animates back to where the user actually is. */
  onRequestTileRect?: (index: number) => Rect | null;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const visible = index != null;

  // Viewer-level transform (distinct from per-page zoom): vScale/vTx/vTy place
  // the content, bg drives the backdrop opacity.
  const vScale = useSharedValue(1);
  const vTx = useSharedValue(0);
  const vTy = useSharedValue(0);
  const bg = useSharedValue(0);

  const [zoomed, setZoomed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});
  const [infoVisible, setInfoVisible] = useState(false);

  const activeIndex = currentIndex ?? index ?? 0;
  const activePhoto: PhotoDTO | undefined = photos[activeIndex];
  const isFavorite = activePhoto ? (favOverride[activePhoto.id] ?? activePhoto.isFavorite) : false;

  // Grow from the tapped tile on open.
  useEffect(() => {
    if (index == null) return;
    const c = collapseToRect(originRect ?? { x: width / 2, y: height / 2, width: 0, height: 0 }, width, height);
    vScale.value = c.s;
    vTx.value = c.tx;
    vTy.value = c.ty;
    bg.value = 0;
    const ease = { duration: OPEN_MS, easing: Easing.out(Easing.cubic) } as const;
    vScale.value = withTiming(1, ease);
    vTx.value = withTiming(0, ease);
    vTy.value = withTiming(0, ease);
    bg.value = withTiming(1, { duration: OPEN_MS });
  }, [index, originRect, width, height, vScale, vTx, vTy, bg]);

  const handleClosed = () => {
    setCurrentIndex(null);
    setZoomed(false);
    setInfoVisible(false);
    onClose();
  };

  // Fly the content to the current photo's grid tile (scrolling the grid there),
  // then unmount. Falls back to the opened tile, then a shrink-to-center fade.
  const flyToTile = () => {
    const rect = onRequestTileRect?.(activeIndex) ?? originRect ?? {
      x: width / 2,
      y: height / 2,
      width: 0,
      height: 0,
    };
    const c = collapseToRect(rect, width, height);
    const ease = { duration: 240, easing: Easing.out(Easing.cubic) } as const;
    vScale.value = withTiming(c.s, ease);
    vTx.value = withTiming(c.tx, ease);
    bg.value = withTiming(0, ease);
    vTy.value = withTiming(c.ty, ease, (finished) => {
      if (finished) runOnJS(handleClosed)();
    });
  };

  const toggleFavorite = () => {
    if (!activePhoto) return;
    const id = activePhoto.id;
    const next = !isFavorite;
    setFavOverride((prev) => ({ ...prev, [id]: next }));
    setFavorite(baseURL, slug, cookie, id, next).catch(() =>
      setFavOverride((prev) => ({ ...prev, [id]: !next })),
    );
  };

  const share = () => {
    if (activePhoto) void shareOriginal(baseURL, slug, cookie, activePhoto).catch(() => {});
  };

  // Interactive swipe-down: follow the finger and shrink live; release past the
  // threshold (or a fast flick) dismisses, else springs back. Horizontal is
  // failed so the FlatList pages instead.
  const dismiss = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-14, 14])
    .failOffsetX([-14, 14])
    .onUpdate((e) => {
      vTx.value = e.translationX;
      vTy.value = e.translationY;
      const d = Math.abs(e.translationY);
      vScale.value = interpolate(d, [0, height], [1, 0.5], Extrapolation.CLAMP);
      bg.value = interpolate(d, [0, height * 0.4], [1, 0.25], Extrapolation.CLAMP);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > DISMISS_THRESHOLD || Math.abs(e.velocityY) > 900) {
        runOnJS(flyToTile)();
      } else {
        vTx.value = withTiming(0);
        vTy.value = withTiming(0);
        vScale.value = withTiming(1);
        bg.value = withTiming(1);
      }
    });

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: vTx.value }, { translateY: vTy.value }, { scale: vScale.value }],
  }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: bg.value }));

  return (
    <>
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={flyToTile}>
        <GestureHandlerRootView style={styles.flex}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }, bgStyle]}
            pointerEvents="none"
          />
          {visible && (
            <GestureDetector gesture={dismiss}>
              <Animated.View style={[styles.flex, contentStyle]}>
                <FlatList
                  key={index}
                  data={photos}
                  horizontal
                  pagingEnabled
                  initialScrollIndex={index}
                  getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                  keyExtractor={(p) => p.id}
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={!zoomed}
                  renderItem={({ item }) => (
                    <ViewerPage
                      photo={item}
                      baseURL={baseURL}
                      slug={slug}
                      cookie={cookie}
                      width={width}
                      height={height}
                      onZoomChange={setZoomed}
                    />
                  )}
                  onMomentumScrollEnd={(e) => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / width);
                    setCurrentIndex(i);
                    if (shouldLoadMore(i, photos.length)) onLoadMore?.();
                  }}
                />
              </Animated.View>
            </GestureDetector>
          )}

          {visible && !zoomed && activePhoto && (
            <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents="box-none">
              <ViewerChrome
                photo={activePhoto}
                topInset={insets.top}
                bottomInset={insets.bottom}
                isFavorite={isFavorite}
                onClose={flyToTile}
                onShare={share}
                onInfo={() => setInfoVisible(true)}
                onToggleFavorite={toggleFavorite}
              />
            </Animated.View>
          )}
        </GestureHandlerRootView>
      </Modal>

      <ViewerInfoSheet
        photo={activePhoto ?? null}
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
