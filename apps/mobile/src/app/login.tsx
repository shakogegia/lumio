import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";

export default function Login() {
  const { serverUrl, isLoading, session, signIn, disconnect } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <View style={styles.center}><ActivityIndicator /></View>;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (session) return <Redirect href="/" />;

  const handleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: authError } = await signIn.email({ email: email.trim(), password });
      if (authError) {
        setError(authError.message ?? "Sign in failed. Check your credentials.");
        return;
      }
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setError("Two-factor auth isn't supported in the app yet.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeServer = async () => {
    await disconnect();
    router.replace("/connect");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lumio</Text>
      <Text style={styles.server}>{serverUrl}</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={handleLogin} disabled={submitting || !email || !password}>
        <Text style={styles.buttonText}>{submitting ? "Signing in…" : "Sign in"}</Text>
      </Pressable>
      <Pressable onPress={handleChangeServer}>
        <Text style={styles.link}>Change server</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center" },
  server: { fontSize: 13, color: "#888", textAlign: "center", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: "#111", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#2563eb", textAlign: "center", marginTop: 12, fontSize: 14 },
  error: { color: "#c00" },
});
