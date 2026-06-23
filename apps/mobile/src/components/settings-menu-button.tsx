import { Platform, View, Text, StyleSheet } from "react-native";
import { MenuView, type MenuAction, type NativeActionEvent } from "@react-native-menu/menu";
import { SymbolView } from "expo-symbols";
import { GlassView } from "expo-glass-effect";
import { GLASS } from "@/lib/glass";
import { useAuth } from "@/contexts/auth-context";
import { useCatalogs } from "@/contexts/catalog-context";
import { useHeaderScrolled } from "@/components/large-header";
import { useTheme } from "@/lib/theme";

/**
 * Glass capsule gear in the header that opens a native iOS UIMenu (inline,
 * anchored, frosted — with a checkmark on the active catalog and a destructive
 * Log Out). Requires the dev build (Expo Go can't load this native module).
 */
export function SettingsMenuButton() {
  const { signOut } = useAuth();
  const { catalogs, activeCatalogId, setActiveCatalog } = useCatalogs();
  const { colors } = useTheme();
  const scrolled = useHeaderScrolled();

  // Catalogs as an inline section (own group/separator), then a destructive Log Out.
  const ios = Platform.OS === "ios";
  const catalogSection: MenuAction[] = catalogs.length
    ? [
        {
          id: "catalogs",
          // Group header for the catalog list (the menu itself has no title, so
          // it only appears once).
          title: "Catalogs",
          displayInline: true,
          subactions: catalogs.map((c): MenuAction => ({
            id: c.id,
            title: c.name,
            // The active one shows a checkmark (state); the rest show the icon.
            state: c.id === activeCatalogId ? "on" : "off",
            image: ios ? "photo.stack" : undefined,
            // Required on the new architecture: without an explicit color the icon
            // is tinted transparent (defaults to 0) and renders invisible.
            imageColor: colors.foreground,
          })),
        },
      ]
    : [];

  const actions: MenuAction[] = [
    ...catalogSection,
    {
      id: "logout",
      title: "Log Out",
      attributes: { destructive: true },
      image: ios ? "rectangle.portrait.and.arrow.right" : undefined,
      imageColor: colors.destructive,
    },
  ];

  const onPressAction = ({ nativeEvent }: NativeActionEvent) => {
    const id = nativeEvent.event;
    if (id === "logout") void signOut();
    else if (catalogs.some((c) => c.id === id)) setActiveCatalog(id);
  };

  // When scrolled the header turns dark, so the icon flips white and the glass
  // gets a dark tint (matches the Photos header buttons).
  const iconColor = scrolled ? "#FFFFFF" : colors.foreground;
  const gear = (
    <SymbolView
      name="gearshape"
      size={22}
      tintColor={iconColor}
      fallback={<Text style={[styles.fallback, { color: iconColor }]}>⚙</Text>}
    />
  );

  return (
    <MenuView actions={actions} onPressAction={onPressAction} shouldOpenOnLongPress={false}>
      {GLASS ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={scrolled ? "rgba(0,0,0,0.28)" : undefined}
          style={styles.capsule}
        >
          {gear}
        </GlassView>
      ) : (
        <View style={[styles.capsule, { backgroundColor: scrolled ? "rgba(0,0,0,0.4)" : colors.muted }]}>
          {gear}
        </View>
      )}
    </MenuView>
  );
}

const styles = StyleSheet.create({
  capsule: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fallback: { fontSize: 20 },
});
