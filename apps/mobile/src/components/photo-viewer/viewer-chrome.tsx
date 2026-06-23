import { type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { GlassView } from "expo-glass-effect";
import type { PhotoDTO } from "@lumio/shared";
import { GLASS } from "@/lib/glass";
import { formatPhotoTitle } from "./viewer-title";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

// Chrome floats over the photo, so icons/text are white with a soft shadow for
// legibility on any image (independent of the theme background behind letterbox).
const ICON = "#FFFFFF";

/** The viewer's overlay chrome: back + date/time title (top), and the action bar
 *  (share left, favorite/info/adjust capsule right) from the iOS layout. */
export function ViewerChrome({
  photo,
  topInset,
  bottomInset,
  isFavorite,
  onClose,
  onShare,
  onInfo,
  onToggleFavorite,
}: {
  photo: PhotoDTO;
  topInset: number;
  bottomInset: number;
  isFavorite: boolean;
  onClose: () => void;
  onShare: () => void;
  onInfo: () => void;
  onToggleFavorite: () => void;
}) {
  const { title, subtitle } = formatPhotoTitle(photo);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { paddingTop: topInset + 8 }]} pointerEvents="box-none">
        <GlassButton onPress={onClose} label="Close">
          <Icon name="chevron.backward" fallback="‹" />
        </GlassButton>
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.side} />
      </View>

      <View style={[styles.bottom, { paddingBottom: bottomInset + 12 }]} pointerEvents="box-none">
        <GlassButton onPress={onShare} label="Share">
          <Icon name="square.and.arrow.up" fallback="⤴" />
        </GlassButton>

        <GlassPill>
          <PillButton onPress={onToggleFavorite} label="Favorite">
            <Icon
              name={isFavorite ? "heart.fill" : "heart"}
              fallback={isFavorite ? "♥" : "♡"}
              tint={isFavorite ? "#FF375F" : ICON}
            />
          </PillButton>
          <PillButton onPress={onInfo} label="Info">
            <Icon name="info.circle" fallback="ⓘ" />
          </PillButton>
          {/* Adjust/edit — placeholder until a mobile editor exists. */}
          <PillButton onPress={undefined} label="Adjust" disabled>
            <Icon name="slider.horizontal.3" fallback="≡" tint="rgba(255,255,255,0.4)" />
          </PillButton>
        </GlassPill>
      </View>
    </View>
  );
}

function Icon({
  name,
  fallback,
  tint = ICON,
}: {
  name: SymbolName;
  fallback: string;
  tint?: string;
}) {
  return (
    <SymbolView
      name={name}
      size={22}
      tintColor={tint}
      fallback={<Text style={[styles.fallback, { color: tint }]}>{fallback}</Text>}
    />
  );
}

function GlassButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      {GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive style={styles.circle}>
          {children}
        </GlassView>
      ) : (
        <View style={[styles.circle, styles.solid]}>{children}</View>
      )}
    </Pressable>
  );
}

function GlassPill({ children }: { children: ReactNode }) {
  return GLASS ? (
    <GlassView glassEffectStyle="regular" style={styles.pill}>
      {children}
    </GlassView>
  ) : (
    <View style={[styles.pill, styles.solid]}>{children}</View>
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
  side: { width: 44 },
  titleWrap: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  title: {
    color: ICON,
    fontSize: 16,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 4,
  },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 1,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 4,
  },
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
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pill: {
    height: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  pillButton: { paddingHorizontal: 16, height: 44, alignItems: "center", justifyContent: "center" },
  solid: { backgroundColor: "rgba(40,40,40,0.7)" },
  fallback: { fontSize: 20 },
});
