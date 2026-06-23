import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";

export default function Home() {
  const { serverUrl, isLoading, session, isPending, disconnect } = useAuth();

  if (isLoading || isPending) return <View style={styles.center}><ActivityIndicator /></View>;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (!session) return <Redirect href="/login" />;

  const handleChangeServer = async () => {
    await disconnect();
    router.replace("/connect");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're signed in</Text>
      <Text style={styles.sub}>{session.user.email}</Text>
      <Text style={styles.server}>{serverUrl}</Text>
      <Pressable style={styles.button} onPress={() => disconnect()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <Pressable onPress={handleChangeServer}>
        <Text style={styles.link}>Change server</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, padding: 24 },
  heading: { fontSize: 24, fontWeight: "700" },
  sub: { fontSize: 16, color: "#555" },
  server: { fontSize: 13, color: "#888", marginBottom: 12 },
  button: { backgroundColor: "#111", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#2563eb", marginTop: 12, fontSize: 14 },
});
