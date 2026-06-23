/* eslint-disable react-hooks/immutability --
   reanimated shared values require the `.value` mutation pattern in worklets and
   gesture/effect callbacks; the React Compiler lint flags these as false
   positives (see components/photo-grid/zoomable-photo-grid.tsx + [[lumio-react-compiler-lint]]). */
import { useEffect } from "react";
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
import { GLASS } from "@/lib/glass";
import { useTheme } from "@/lib/theme";
import { ViewerPage } from "./viewer-page";
import { shouldLoadMore } from "./pager";

const DISMISS_THRESHOLD = 120;

/**
 * Reusable fullscreen photo viewer. Collection-agnostic: pass an ordered
 * `photos` array + an `index` to open at (null = closed), so the Photos tab and
 * a future album screen reuse it with sort intact and paging continued via
 * `onLoadMore`. Rendered as a `Modal` so it covers the native tab bar.
 *
 * Phase 1: horizontal paging (FlatList), theme background, glass back button, and
 * a swipe-down-to-dismiss gesture. Shared-element open, in-photo zoom, and the
 * action bar are added in later phases.
 */
export function PhotoViewer({
  photos,
  index,
  baseURL,
  slug,
  cookie,
  onClose,
  onLoadMore,
}: {
  photos: PhotoDTO[];
  index: number | null;
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

  const ty = useSharedValue(0);
  const appear = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      ty.value = 0;
      appear.value = withTiming(1, { duration: 220 });
    } else {
      appear.value = 0;
    }
  }, [visible, ty, appear]);

  // Vertical drag dismisses; horizontal is failed so the FlatList pages instead.
  const dismiss = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > DISMISS_THRESHOLD) runOnJS(onClose)();
      else ty.value = withTiming(0);
    });

  const bgStyle = useAnimatedStyle(() => ({
    opacity: appear.value * interpolate(Math.abs(ty.value), [0, 400], [1, 0.2], Extrapolation.CLAMP),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: ty.value },
      { scale: interpolate(Math.abs(ty.value), [0, 400], [1, 0.86], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
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
                renderItem={({ item }) => (
                  <ViewerPage
                    photo={item}
                    baseURL={baseURL}
                    slug={slug}
                    cookie={cookie}
                    width={width}
                    height={height}
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

        <Pressable
          onPress={onClose}
          style={[styles.back, { top: insets.top + 8 }]}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
        >
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
