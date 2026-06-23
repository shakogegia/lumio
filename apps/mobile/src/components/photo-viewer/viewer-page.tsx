import { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Image } from "expo-image";
import type { PhotoDTO } from "@lumio/shared";
import { displayUrl } from "@/lib/photos-api";
import { clampOffset, DOUBLE_TAP_ZOOM, MAX_ZOOM } from "./zoom-math";

/**
 * One full-screen page: the display rendition (edited-or-base WebP), contained,
 * with the ThumbHash blur placeholder and auth Cookie header. Pinch + double-tap
 * + pan zoom is local to the page; `onZoomChange` tells the viewer to disable
 * paging/dismiss while zoomed so they don't fight the pan.
 */
export const ViewerPage = memo(function ViewerPage({
  photo,
  baseURL,
  slug,
  cookie,
  width,
  height,
  onZoomChange,
}: {
  photo: PhotoDTO;
  baseURL: string;
  slug: string;
  cookie: string;
  width: number;
  height: number;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const report = (z: boolean) => {
    setZoomed(z);
    onZoomChange?.(z);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(report)(false);
      } else {
        savedScale.value = scale.value;
        runOnJS(report)(true);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.01) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(report)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
        runOnJS(report)(true);
      }
    });

  // Pan only steers the image while zoomed; disabled at scale 1 so the FlatList
  // pages and the viewer's swipe-down dismiss get the gesture instead.
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      tx.value = clampOffset(savedTx.value + e.translationX, scale.value, width);
      ty.value = clampOffset(savedTy.value + e.translationY, scale.value, height);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          <Image
            style={StyleSheet.absoluteFill}
            source={{ uri: displayUrl(baseURL, slug, photo), headers: { Cookie: cookie } }}
            placeholder={photo.thumbhash ? { thumbhash: photo.thumbhash } : undefined}
            contentFit="contain"
            transition={150}
            recyclingKey={photo.id}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
});
