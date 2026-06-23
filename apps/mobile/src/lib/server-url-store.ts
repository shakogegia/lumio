import * as SecureStore from "expo-secure-store";

// The chosen server URL is persisted so the app reconnects on next launch.
// Not secret, but SecureStore is already a dependency and works for this.
const KEY = "lumio.serverUrl";

export async function getStoredServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setStoredServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, url);
}

export async function clearStoredServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
