import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth-context";
import { AnimatedSplash } from "../components/animated-splash";

export default function RootLayout() {
  return (
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
  );
}
