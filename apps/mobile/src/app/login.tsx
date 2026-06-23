import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Redirect, router } from "expo-router";
import { signIn, useSession } from "../lib/auth-client";

export default function Login() {
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated → go home.
  if (session) return <Redirect href="/" />;

  const handleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: authError } = await signIn.email({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(authError.message ?? "Sign in failed. Check your credentials.");
        return;
      }
      // 2FA is enabled on the backend; a TOTP-protected account returns a
      // redirect instead of a session. Full TOTP entry is a later milestone.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setError("Two-factor auth isn't supported in the app yet.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Could not reach the server. Check EXPO_PUBLIC_API_URL.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lumio</Text>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <>
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
          <Pressable
            style={styles.button}
            onPress={handleLogin}
            disabled={submitting || !email || !password}
          >
            <Text style={styles.buttonText}>
              {submitting ? "Signing in…" : "Sign in"}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center", marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#111",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c00" },
});
