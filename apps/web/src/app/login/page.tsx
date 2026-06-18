import { redirect } from "next/navigation";
import { hasAnyUser } from "@lumio/db";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Fresh install with no account yet → go create the admin.
  if (!(await hasAnyUser())) redirect("/setup");
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
