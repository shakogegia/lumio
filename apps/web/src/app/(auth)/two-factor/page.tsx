import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { TwoFactorVerifyForm } from "./two-factor-verify-form";

export const dynamic = "force-dynamic";

export default async function TwoFactorPage() {
  // A full session only exists *after* the second factor is verified. If one
  // already exists, there's nothing to verify — go to the app.
  const session = await getServerSession();
  if (session) {
    redirect("/photos");
  }
  return <TwoFactorVerifyForm />;
}
