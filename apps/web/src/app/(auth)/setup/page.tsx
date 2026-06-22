import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAnyUser, listCatalogs } from "@lumio/db";
import { getServerSession } from "@/lib/server-session";
import { SetupForm } from "./setup-form";
import { FirstCatalogForm } from "./first-catalog-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Set Up" };

export default async function SetupPage() {
  // First-run setup is a two-step wizard: create the admin account, then point
  // Lumio at its first catalog. The gate decides which step (or to bounce out).
  const userExists = await hasAnyUser();
  if (!userExists) return <SetupForm />; // step 1: create the admin account

  const catalogs = await listCatalogs();
  // Fully set up → home; the root redirect picks a catalog to land in.
  if (catalogs.length > 0) redirect("/");

  // A user exists but no catalog does. Only the signed-in admin (the visitor who
  // just created the account) may finish setup; everyone else goes to login.
  const session = await getServerSession();
  if (!session) redirect("/login");

  return <FirstCatalogForm />; // step 2: create the first catalog
}
