import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { useTheme, weight } from "../lib/theme";
import { Brand } from "../components/logo";
import { Screen, Card, Separator, Loading } from "../components/ui/layout";
import { FieldRow } from "../components/ui/field";
import { Button, TextLink } from "../components/ui/button";

export default function Login() {
  const { serverUrl, isLoading, session, signIn, disconnect } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <Loading />;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (session) return <Redirect href="/" />;

  const clearError = () => {
    if (error) setError(null);
  };

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

  const canSubmit = !!email.trim() && !!password;

  return (
    <Screen>
      <View style={styles.header}>
        <Brand logoSize={68} />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Sign in to your Lumio library.</Text>
        </View>
      </View>

      <View>
        <Card>
          <FieldRow
            placeholder="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              clearError();
            }}
          />
          <Separator />
          <FieldRow
            placeholder="Password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              clearError();
            }}
            onSubmitEditing={canSubmit ? handleLogin : undefined}
          />
        </Card>
        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      </View>

      <Button label="Login" onPress={handleLogin} loading={submitting} disabled={!canSubmit} />

      <View style={styles.footer}>
        <Text style={[styles.server, { color: colors.mutedForeground }]} numberOfLines={1}>
          {serverUrl}
        </Text>
        <TextLink label="Change server" onPress={handleChangeServer} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 20 },
  headerText: { alignItems: "center", gap: 4 },
  title: { fontSize: 24, fontWeight: weight.semibold, letterSpacing: -0.3 },
  sub: { fontSize: 14 },
  error: { fontSize: 13, marginTop: 8, marginHorizontal: 16 },
  footer: { alignItems: "center", gap: 10 },
  server: { fontSize: 12, maxWidth: "90%" },
});
