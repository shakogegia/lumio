import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "../lib/theme";
import { Brand } from "../components/logo";
import { Screen, SectionHeader, Card, Separator, Loading } from "../components/ui/layout";
import { FieldRow, InputPrefix, ErrorBadge, SwitchRow } from "../components/ui/field";
import { Button } from "../components/ui/button";

export default function Connect() {
  const { serverUrl, isLoading, connect } = useAuth();
  const { colors } = useTheme();
  const [host, setHost] = useState("");
  const [secure, setSecure] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <Loading />;
  if (serverUrl) return <Redirect href="/login" />;

  // The scheme lives in the toggle, so the input holds only the host. If a scheme
  // is pasted in, peel it off and flip the toggle to match.
  const onChangeHost = (text: string) => {
    const match = /^(https?):\/\//i.exec(text);
    if (match) {
      setSecure(match[1].toLowerCase() === "https");
      setHost(text.slice(match[0].length));
    } else {
      setHost(text);
    }
    if (error) setError(null);
  };

  const handleConnect = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await connect(`${secure ? "https" : "http"}://${host.trim()}`);
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <Brand />
      <View>
        <SectionHeader>Server Address</SectionHeader>
        <Card>
          <FieldRow
            prefix={<InputPrefix>{secure ? "https://" : "http://"}</InputPrefix>}
            trailing={error ? <ErrorBadge /> : undefined}
            placeholder="lumio.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            value={host}
            onChangeText={onChangeHost}
            onSubmitEditing={host.trim() ? handleConnect : undefined}
          />
          <Separator />
          <SwitchRow label="Secure Connection" value={secure} onValueChange={setSecure} />
        </Card>
        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      </View>
      <Button label="Connect" onPress={handleConnect} loading={submitting} disabled={!host.trim()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 13, marginTop: 8, marginHorizontal: 16 },
});
