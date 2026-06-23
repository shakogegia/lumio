import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* `auto` flips status-bar text to match the system light/dark scheme. */}
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
