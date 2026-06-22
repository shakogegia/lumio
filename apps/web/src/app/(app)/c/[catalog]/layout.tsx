import { redirect } from "next/navigation";
import { getUserSettings } from "@lumio/db";
import { AppSidebar } from "@/components/app-sidebar";
import { LibraryTreeProvider } from "@/components/library-tree/library-tree";
import { SoundSettingsProvider } from "@/components/sound-settings-provider";
import { CatalogProvider } from "@/lib/catalog-context";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { getServerSession } from "@/lib/server-session";
import { RememberCatalog } from "./remember-catalog";

export default async function CatalogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ catalog: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  const settings = await getUserSettings(session.user.id);
  return (
    <CatalogProvider catalog={{ id: catalog.id, slug: catalog.slug, name: catalog.name }}>
      <RememberCatalog slug={catalog.slug} />
      <LibraryTreeProvider>
        <SoundSettingsProvider enabled={settings.soundEffectsEnabled} />
        {/* Sidebar is fixed (not in flow); offset content by its 76px width. */}
        <AppSidebar />
        <div className="min-h-dvh pl-[76px]">{children}</div>
      </LibraryTreeProvider>
    </CatalogProvider>
  );
}
