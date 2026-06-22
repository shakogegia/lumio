import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}
