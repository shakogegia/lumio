import { useEffect, useState } from "react";
import { Animated, StyleSheet, useColorScheme } from "react-native";
import { Image } from "expo-image";
import * as SplashScreen from "expo-splash-screen";

// Same aperture assets the native splash uses, so the native→JS handoff is
// pixel-identical (black on the white light splash, white on the black dark one).
const LIGHT = require("../../assets/images/splash-icon-light.png");
const DARK = require("../../assets/images/splash-icon-dark.png");

// Hold the native splash until the JS overlay has mounted to take over.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Overlays the app on launch with a copy of the native splash, then plays a
 * short aperture zoom-and-dissolve to reveal the app underneath. Renders nothing
 * once the animation finishes.
 */
export function AnimatedSplash() {
  const dark = useColorScheme() === "dark";
  const [done, setDone] = useState(false);
  // Lazy state (not refs) so the animated values are stable yet readable in
  // render — the React Compiler lint forbids reading refs there.
  const [opacity] = useState(() => new Animated.Value(1));
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    // Hand off from the native splash to this identical overlay, then reveal.
    SplashScreen.hideAsync().catch(() => {});
    const animation = Animated.sequence([
      Animated.delay(220),
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.18, duration: 460, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 420, delay: 80, useNativeDriver: true }),
      ]),
    ]);
    animation.start(({ finished }) => {
      if (finished) setDone(true);
    });
    return () => animation.stop();
  }, [opacity, scale]);

  if (done) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: dark ? "#000000" : "#FFFFFF", opacity }]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Image source={dark ? DARK : LIGHT} style={styles.mark} contentFit="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  mark: { width: 120, height: 120 },
});
