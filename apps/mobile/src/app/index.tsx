import { Redirect } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { Loading } from "@/components/ui/layout";

/**
 * Entry route. Resolves where to send the user based on auth state:
 * no server → /connect, no session → /login, otherwise into the tab shell.
 */
export default function Index() {
  const { serverUrl, isLoading, session, isPending } = useAuth();

  if (isLoading || isPending) return <Loading />;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (!session) return <Redirect href="/login" />;
  return <Redirect href="/photos" />;
}
