import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { signOut, useSession } from "../lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  // Not authenticated → login.
  if (!session) return <Redirect href="/login" />;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're signed in</Text>
      <Text style={styles.sub}>{session.user.email}</Text>
      <Pressable style={styles.button} onPress={() => signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  heading: { fontSize: 24, fontWeight: "700" },
  sub: { fontSize: 16, color: "#555" },
  button: {
    backgroundColor: "#111",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
