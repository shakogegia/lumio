import { Platform, DynamicColorIOS } from "react-native";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useAuth } from "@/contexts/auth-context";
import { CatalogProvider } from "@/contexts/catalog-context";
import { useTheme } from "@/lib/theme";
import { Loading } from "@/components/ui/layout";

// Selected-tab tint = brand monochrome. DynamicColorIOS lets iOS resolve it
// against the glass tab bar's appearance; Android uses the themed value.
const tabTint =
  Platform.OS === "ios"
    ? DynamicColorIOS({ light: "#171717", dark: "#FAFAFA" })
    : undefined;

/** Auth gate for the whole app shell, then the native (Liquid Glass on iOS 26)
 *  tab bar. Each tab nests its own Stack for a native large-title header. */
export default function TabsLayout() {
  const { serverUrl, isLoading, session, isPending } = useAuth();
  const { colors } = useTheme();

  if (isLoading || isPending) return <Loading />;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (!session) return <Redirect href="/login" />;

  return (
    <CatalogProvider>
      <NativeTabs tintColor={tabTint ?? colors.foreground}>
        <NativeTabs.Trigger name="photos">
          <NativeTabs.Trigger.Icon sf="photo.on.rectangle" />
          <NativeTabs.Trigger.Label>Photos</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="albums">
          <NativeTabs.Trigger.Icon sf="rectangle.stack" />
          <NativeTabs.Trigger.Label>Albums</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </CatalogProvider>
  );
}
