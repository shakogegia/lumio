import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/contexts/auth-context";
import { AnimatedSplash } from "@/components/animated-splash";

export default function RootLayout() {
  return (
    // Root for react-native-gesture-handler (required for the photo grid's pinch).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* `auto` flips status-bar text to match the system light/dark scheme. */}
          <StatusBar style="auto" />
          {/* Native default transition for in-app navigation. The launch reveal is
              a fade owned by <AnimatedSplash/>, which also covers the initial
              redirect (index → connect/login) so its slide isn't seen on entry. */}
          <Stack screenOptions={{ headerShown: false }} />
          <AnimatedSplash />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
