import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";

export default function Connect() {
  const { serverUrl, isLoading, connect } = useAuth();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.center}><ActivityIndicator /></View>
    );
  }
  if (serverUrl) return <Redirect href="/login" />;

  const handleConnect = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await connect(url);
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect to Lumio</Text>
      <Text style={styles.sub}>Enter the address of your Lumio server.</Text>
      <TextInput
        style={styles.input}
        placeholder="https://photos.example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={url}
        onChangeText={setUrl}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={handleConnect} disabled={submitting || !url}>
        <Text style={styles.buttonText}>{submitting ? "Connecting…" : "Connect"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 15, color: "#555", textAlign: "center", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: "#111", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c00" },
});
