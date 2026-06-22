import { getDefaultCatalogSlug } from "@/lib/active-catalog";
import { catalogPath } from "@/lib/catalog-api";
import { SettingsSidebar } from "@/components/settings-sidebar";

// Session gating is inherited from (app)/layout.tsx. This layout is
// catalog-agnostic; the per-catalog detail page supplies its own catalog context.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await getDefaultCatalogSlug();
  const backHref = slug ? catalogPath(slug, "/photos") : "/";
  return (
    <>
      <SettingsSidebar backHref={backHref} />
      {/* Offset content by the 76px fixed rail, matching the main app layout. */}
      <div className="min-h-dvh pl-[76px]">{children}</div>
    </>
  );
}
