/* eslint-disable react-hooks/immutability --
   reanimated shared values require the `.value` mutation pattern in worklets and
   gesture/effect callbacks; the React Compiler lint flags these as false
   positives (see components/photo-grid/zoomable-photo-grid.tsx + [[lumio-react-compiler-lint]]). */
import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, StyleSheet, useWindowDimensions } from "react-native";
import { GestureDetector, GestureHandlerRootView, Gesture } from "react-native-gesture-handler";
import Animated, {
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

const DISMISS_THRESHOLD = 120;
const OPEN_MS = 260;
const CLOSE_MS = 230;

/**
 * Reusable fullscreen photo viewer. Collection-agnostic: pass an ordered
 * `photos` array + an `index` to open at (null = closed), so the Photos tab and
 * a future album screen reuse it with sort intact and paging continued via
 * `onLoadMore`. Rendered as a `Modal` so it covers the native tab bar.
 *
 * `progress` (0 = collapsed to the tapped tile `originRect`, 1 = fullscreen)
 * drives an iOS shared-element open/close: the whole viewer scales uniformly
 * (no distortion) from the tile and back. Swipe-down slides the content off and
 * dismisses. In-photo zoom + the action bar are added in later phases.
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
}: {
  photos: PhotoDTO[];
  index: number | null;
  originRect: Rect | null;
  baseURL: string;
  slug: string;
  cookie: string;
  onClose: () => void;
  onLoadMore?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const visible = index != null;

  const progress = useSharedValue(0);
  const ty = useSharedValue(0);
  // True while the active page is pinch/double-tap zoomed — paging + swipe-down
  // dismiss are disabled so the page's pan owns the gesture.
  const [zoomed, setZoomed] = useState(false);
  // The page currently centered (null until first paged → falls back to `index`).
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  // Optimistic favorite flips, keyed by photo id (server call may lag).
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});
  const [infoVisible, setInfoVisible] = useState(false);

  const activeIndex = currentIndex ?? index ?? 0;
  const activePhoto: PhotoDTO | undefined = photos[activeIndex];
  const isFavorite = activePhoto
    ? (favOverride[activePhoto.id] ?? activePhoto.isFavorite)
    : false;

  // The collapsed transform that maps the fullscreen content onto the tile:
  // uniform scale (tile width / screen width) + translate to the tile center.
  const collapse = useMemo(() => {
    if (!originRect || width === 0 || height === 0) return { s: 0.9, tx: 0, ty: 0 };
    return {
      s: originRect.width / width,
      tx: originRect.x + originRect.width / 2 - width / 2,
      ty: originRect.y + originRect.height / 2 - height / 2,
    };
  }, [originRect, width, height]);

  useEffect(() => {
    if (index != null) {
      ty.value = 0;
      progress.value = 0;
      progress.value = withTiming(1, { duration: OPEN_MS });
    }
  }, [index, progress, ty]);

  // Reset transient state and tell the parent to unmount.
  const handleClosed = () => {
    setCurrentIndex(null);
    setZoomed(false);
    setInfoVisible(false);
    onClose();
  };

  // Reverse the open animation back to the tile, then unmount.
  const close = () => {
    setZoomed(false);
    progress.value = withTiming(0, { duration: CLOSE_MS }, (finished) => {
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

  const dismiss = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-12, 12])
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > DISMISS_THRESHOLD) {
        const dir = e.translationY > 0 ? 1 : -1;
        ty.value = withTiming(dir * height, { duration: 220 }, (finished) => {
          if (finished) runOnJS(handleClosed)();
        });
      } else {
        ty.value = withTiming(0);
      }
    });

  const bgStyle = useAnimatedStyle(() => ({
    opacity:
      progress.value * interpolate(Math.abs(ty.value), [0, 400], [1, 0.15], Extrapolation.CLAMP),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [collapse.tx, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [collapse.ty, 0]) + ty.value },
      { scale: interpolate(progress.value, [0, 1], [collapse.s, 1]) },
    ],
  }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <>
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
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
              onClose={close}
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
