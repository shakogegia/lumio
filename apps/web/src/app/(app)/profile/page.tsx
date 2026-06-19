import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { AccountForm } from "./account-form";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <AccountForm name={session.user.name} email={session.user.email} />
      <PasswordForm />
    </main>
  );
}
