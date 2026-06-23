import { Stack } from "expo-router";

// Custom in-screen header (LargeHeaderScreen), so the native header is off.
// The Stack stays for future push navigation within the Photos tab.
export default function PhotosLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
