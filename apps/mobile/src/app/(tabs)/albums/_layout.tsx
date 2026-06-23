import { Stack } from "expo-router";

// Custom in-screen header (LargeHeaderScreen), so the native header is off.
export default function AlbumsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
