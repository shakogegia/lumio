import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountForm } from "./account-form";
import { PasswordForm } from "./password-form";
import { TwoFactorSection } from "./two-factor-section";
import { SessionsList, type SessionRow } from "./sessions-list";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  // Fetch active sessions server-side and reduce to a serializable shape for the
  // client list. listSessions returns the raw session rows for the current user.
  const rawSessions = await auth.api.listSessions({ headers: await headers() });
  const sessions: SessionRow[] = rawSessions
    .map((s) => ({
      id: s.id,
      token: s.token,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      createdAt: new Date(s.createdAt).toISOString(),
      updatedAt: new Date(s.updatedAt).toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>

      <Tabs defaultValue="account" className="gap-6">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountForm name={session.user.name} email={session.user.email} />
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>
                Require a code from an authenticator app when you sign in.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TwoFactorSection
                enabled={Boolean(session.user.twoFactorEnabled)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
              <CardDescription>
                Devices currently signed in to your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SessionsList
                sessions={sessions}
                currentToken={session.session.token}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
