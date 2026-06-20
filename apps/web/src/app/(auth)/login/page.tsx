import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAnyUser } from "@lumio/db";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign In" };

export default async function LoginPage() {
  // Fresh install with no account yet → go create the admin.
  if (!(await hasAnyUser())) redirect("/setup");
  return <LoginForm />;
}
