import { type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { GlassView } from "expo-glass-effect";
import type { PhotoDTO } from "@lumio/shared";
import { GLASS } from "@/lib/glass";
import { useTheme } from "@/lib/theme";
import { formatPhotoTitle } from "./viewer-title";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

const FAVORITE_RED = "#FF375F";

/** The viewer's overlay chrome: back + date/time title (top), and the action bar
 *  (share left, favorite/info/adjust capsule right) from the iOS layout. Glass
 *  + icon/text colors are theme-aware so they're legible on the white light-mode
 *  background as well as dark. */
export function ViewerChrome({
  photo,
  topInset,
  isFavorite,
  onClose,
  onShare,
  onInfo,
  onToggleFavorite,
}: {
  photo: PhotoDTO;
  topInset: number;
  isFavorite: boolean;
  onClose: () => void;
  onShare: () => void;
  onInfo: () => void;
  onToggleFavorite: () => void;
}) {
  const { colors, scheme } = useTheme();
  const { title, subtitle } = formatPhotoTitle(photo);
  // Icons/text follow the theme (dark on light, white on dark); the glass — or
  // its non-glass fallback — provides the contrasting backing over the photo.
  const fg = colors.foreground;
  const solid = scheme === "dark" ? "rgba(30,30,30,0.72)" : "rgba(245,245,245,0.92)";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { paddingTop: topInset + 8 }]} pointerEvents="box-none">
        <GlassCircle onPress={onClose} label="Close" solid={solid}>
          <Icon name="chevron.backward" fallback="‹" tint={fg} />
        </GlassCircle>
        <GlassContainer solid={solid} style={styles.titlePill} radius={21}>
          <Text style={[styles.title, { color: fg }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: fg }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </GlassContainer>
        <View style={styles.side} />
      </View>

      <View style={[styles.bottom, styles.bottomPad]} pointerEvents="box-none">
        <GlassCircle onPress={onShare} label="Share" solid={solid}>
          <Icon name="square.and.arrow.up" fallback="⤴" tint={fg} />
        </GlassCircle>

        <GlassContainer solid={solid} style={styles.pill} radius={21} interactive>
          <PillButton onPress={onToggleFavorite} label="Favorite">
            <Icon
              name={isFavorite ? "heart.fill" : "heart"}
              fallback={isFavorite ? "♥" : "♡"}
              tint={isFavorite ? FAVORITE_RED : fg}
            />
          </PillButton>
          <PillButton onPress={onInfo} label="Info">
            <Icon name="info.circle" fallback="ⓘ" tint={fg} />
          </PillButton>
          {/* Adjust/edit — placeholder until a mobile editor exists. */}
          <PillButton onPress={undefined} label="Adjust" disabled>
            <Icon name="slider.horizontal.3" fallback="≡" tint={fg} dim />
          </PillButton>
        </GlassContainer>
      </View>
    </View>
  );
}

function Icon({
  name,
  fallback,
  tint,
  dim,
}: {
  name: SymbolName;
  fallback: string;
  tint: string;
  dim?: boolean;
}) {
  return (
    <View style={dim ? styles.dim : undefined}>
      <SymbolView
        name={name}
        size={22}
        tintColor={tint}
        fallback={<Text style={[styles.fallback, { color: tint }]}>{fallback}</Text>}
      />
    </View>
  );
}

function GlassContainer({
  solid,
  style,
  radius,
  interactive,
  children,
}: {
  solid: string;
  style: object;
  radius: number;
  interactive?: boolean;
  children: ReactNode;
}) {
  // The glass clips its material with overflow:hidden, which would also clip a
  // shadow — so the elevation shadow goes on an outer wrapper (matching radius,
  // no clipping) and the clipped glass sits inside it.
  const inner = GLASS ? (
    <GlassView glassEffectStyle="regular" isInteractive={interactive} style={style}>
      {children}
    </GlassView>
  ) : (
    <View style={[style, { backgroundColor: solid }]}>{children}</View>
  );
  return <View style={[styles.shadow, { borderRadius: radius }]}>{inner}</View>;
}

function GlassCircle({
  onPress,
  label,
  solid,
  children,
}: {
  onPress: () => void;
  label: string;
  solid: string;
  children: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <GlassContainer solid={solid} style={styles.circle} radius={21} interactive>
        {children}
      </GlassContainer>
    </Pressable>
  );
}

function PillButton({
  onPress,
  label,
  disabled,
  children,
}: {
  onPress?: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={styles.pillButton}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  side: { width: 42 },
  titlePill: {
    height: 42, // match the back-arrow capsule so the header row is even
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    borderRadius: 21,
    overflow: "hidden",
    minWidth: 200,
    maxWidth: "78%",
  },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 18 },
  subtitle: { fontSize: 11, lineHeight: 13, opacity: 0.6 },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  // Sit near the very bottom (tab-bar level), not lifted by the safe-area inset.
  bottomPad: { paddingBottom: 16 },
  circle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pill: { height: 42, borderRadius: 21, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  pillButton: { paddingHorizontal: 16, height: 42, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.4 },
  fallback: { fontSize: 20 },
  // Elevation shadow on the (unclipped) wrapper so the glass lifts off the photo.
  shadow: {
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
