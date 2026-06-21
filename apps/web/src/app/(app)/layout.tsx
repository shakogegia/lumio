import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { LibraryTreeProvider } from "@/components/library-tree/library-tree";
import { getServerSession } from "@/lib/server-session";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <LibraryTreeProvider>
      {/* Sidebar is fixed (not in flow); offset content by its 76px width. */}
      <AppSidebar />
      <div className="min-h-dvh pl-[76px]">{children}</div>
    </LibraryTreeProvider>
  );
}
