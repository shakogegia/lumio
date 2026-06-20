import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAnyUser } from "@lumio/db";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Set Up" };

export default async function SetupPage() {
  // Setup is one-time: once any account exists, send people to login.
  if (await hasAnyUser()) redirect("/login");
  return <SetupForm />;
}
