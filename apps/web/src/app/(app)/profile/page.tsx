import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountForm } from "./account-form";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  // (app)/layout.tsx already redirects unauthenticated requests; we still fetch
  // the session here for the user's name/email, and this null check narrows the
  // type before reading session.user (the redirect is belt-and-suspenders).
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>

      <Tabs defaultValue="account" className="gap-6">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountForm name={session.user.name} email={session.user.email} />
        </TabsContent>

        <TabsContent value="password">
          <PasswordForm />
        </TabsContent>
      </Tabs>
    </main>
  );
}
