/* eslint-disable react-hooks/immutability --
   reanimated shared values require the `.value` mutation pattern in worklets and
   gesture/effect callbacks; the React Compiler lint flags these as false
   positives (see components/photo-grid/zoomable-photo-grid.tsx + [[lumio-react-compiler-lint]]). */
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
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
import { SymbolView } from "expo-symbols";
import { GlassView } from "expo-glass-effect";
import type { PhotoDTO } from "@lumio/shared";
import type { Rect } from "@/lib/rect";
import { GLASS } from "@/lib/glass";
import { useTheme } from "@/lib/theme";
import { ViewerPage } from "./viewer-page";
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

  // Reverse the open animation back to the tile, then unmount.
  const close = () => {
    setZoomed(false);
    progress.value = withTiming(0, { duration: CLOSE_MS }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
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
          if (finished) runOnJS(onClose)();
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
                  if (shouldLoadMore(i, photos.length)) onLoadMore?.();
                }}
              />
            </Animated.View>
          </GestureDetector>
        )}

        <Animated.View style={[styles.back, { top: insets.top + 8 }, chromeStyle]}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            {GLASS ? (
              <GlassView glassEffectStyle="regular" isInteractive style={styles.backCapsule}>
                <BackIcon />
              </GlassView>
            ) : (
              <View style={[styles.backCapsule, styles.backSolid]}>
                <BackIcon />
              </View>
            )}
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function BackIcon() {
  return (
    <SymbolView
      name="chevron.backward"
      size={20}
      tintColor="#FFFFFF"
      fallback={<Text style={styles.backFallback}>‹</Text>}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  back: { position: "absolute", left: 16 },
  backCapsule: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  backSolid: { backgroundColor: "rgba(0,0,0,0.4)" },
  backFallback: { color: "#FFFFFF", fontSize: 24, lineHeight: 24 },
});
