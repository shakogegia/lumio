import { View, Text, StyleSheet } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";
import { useTheme, weight } from "../lib/theme";
import { Brand } from "../components/logo";
import { Screen, Loading } from "../components/ui/layout";
import { Button, TextLink } from "../components/ui/button";

export default function Home() {
  const { serverUrl, isLoading, session, isPending, signOut, disconnect } = useAuth();
  const { colors } = useTheme();

  if (isLoading || isPending) return <Loading />;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (!session) return <Redirect href="/login" />;

  // Sign out ends the session but keeps the server (the `!session` guard then
  // routes to /login). Change server forgets the server entirely.
  const handleChangeServer = async () => {
    await disconnect();
    router.replace("/connect");
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Brand />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>You&apos;re signed in</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>{session.user.email}</Text>
        </View>
      </View>

      <Button label="Sign out" onPress={() => signOut()} />

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
  sub: { fontSize: 15 },
  footer: { alignItems: "center", gap: 10 },
  server: { fontSize: 12, maxWidth: "90%" },
});
