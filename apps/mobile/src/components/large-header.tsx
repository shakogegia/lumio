import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { setStatusBarStyle } from "expo-status-bar";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, weight } from "@/lib/theme";

// Lets header actions (e.g. the gear) react to scroll — darker glass + white
// icon once the dark blur is in.
const HeaderScrollContext = createContext(false);
export const useHeaderScrolled = () => useContext(HeaderScrollContext);

const TITLE_ROW = 52;
// Extends a bit past the title so the blur covers the text slightly before the
// gradient tapers it out just below the baseline.
const BLUR_EXTRA = 40;
// Scroll distance at which the header is considered "scrolled".
const THRESHOLD = 8;

/**
 * Scroll-edge header state, reusable over ANY scroller (ScrollView or FlashList).
 * Returns the `scrolled` flag, the 0->1 `anim` value driving blur/title, an
 * `onScroll` handler to attach to the scroller, and `headerHeight` for content
 * padding. The status bar flips to light over the dark scrolled blur.
 */
export function useScrollEdgeHeader() {
  const insets = useSafeAreaInsets();
  const [scrolled, setScrolled] = useState(false);
  // Drives blur opacity + title color together (JS-driven; a short threshold
  // transition, not a per-frame scroll link).
  const [anim] = useState(() => new Animated.Value(0));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > THRESHOLD;
    if (next !== scrolled) {
      setScrolled(next);
      // Imperative so it reliably overrides the root StatusBar.
      setStatusBarStyle(next ? "light" : "auto", true);
      Animated.timing(anim, { toValue: next ? 1 : 0, duration: 220, useNativeDriver: false }).start();
    }
  };

  // Restore the default status bar when the screen unmounts (e.g. on logout).
  useEffect(() => () => setStatusBarStyle("auto", false), []);

  return { scrolled, anim, onScroll, headerHeight: insets.top + TITLE_ROW };
}

/**
 * The fixed large title + progressive scroll-edge blur. Absolutely positioned —
 * render it as a sibling ON TOP of a scroller whose onScroll comes from
 * useScrollEdgeHeader(). Provides HeaderScrollContext so the `right` slot can
 * react to scroll.
 */
export function LargeHeaderOverlay({
  title,
  right,
  scrolled,
  anim,
  headerHeight,
}: {
  title: string;
  right?: ReactNode;
  scrolled: boolean;
  anim: Animated.Value;
  headerHeight: number;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const titleColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.foreground, "#FFFFFF"],
  });

  return (
    <HeaderScrollContext.Provider value={scrolled}>
      {/* Progressive blur: subtle dark material, opaque at top, fading to clear
          at the bottom edge (no hard line). Fades in as you scroll. */}
      <Animated.View
        style={[styles.blurLayer, { height: headerHeight + BLUR_EXTRA, opacity: anim }]}
        pointerEvents="none"
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              style={StyleSheet.absoluteFill}
              colors={["black", "black", "transparent"]}
              locations={[0, 0.7, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            />
          }
        >
          <BlurView intensity={15} tint="dark" style={StyleSheet.absoluteFill} />
        </MaskedView>
      </Animated.View>

      <View
        style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <View style={styles.titleRow} pointerEvents="box-none">
          <Animated.Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>
            {title}
          </Animated.Text>
          {right}
        </View>
      </View>
    </HeaderScrollContext.Provider>
  );
}

/**
 * iOS Photos-style screen: a fixed large title over a ScrollView. For a
 * virtualized list (FlashList), compose useScrollEdgeHeader + LargeHeaderOverlay
 * directly over the list instead of using this wrapper.
 */
export function LargeHeaderScreen({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { scrolled, anim, onScroll, headerHeight } = useScrollEdgeHeader();

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 96 }}
        scrollIndicatorInsets={{ top: TITLE_ROW }}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
      <LargeHeaderOverlay
        title={title}
        right={right}
        scrolled={scrolled}
        anim={anim}
        headerHeight={headerHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  blurLayer: { position: "absolute", top: 0, left: 0, right: 0 },
  header: { position: "absolute", top: 0, left: 0, right: 0 },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  title: { fontSize: 32, fontWeight: weight.bold, letterSpacing: -0.5 },
});
