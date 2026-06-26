import { redirect } from "next/navigation";
import { getUserSettings, resolveFeatures, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { AppSidebar } from "@/components/app-sidebar";
import { LibraryTreeProvider } from "@/components/library-tree/library-tree";
import { SoundSettingsProvider } from "@/components/sound-settings-provider";
import { FeaturesProvider } from "@/components/features/features-provider";
import { CatalogProvider } from "@/components/providers/catalog-context";
import { MetadataSchemaProvider } from "@/components/providers/metadata-schema-provider";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { getServerSession } from "@/lib/server/server-session";
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
  const [settings, features, metaOn, rawSchema] = await Promise.all([
    getUserSettings(session.user.id),
    resolveFeatures(catalog.id),
    isFeatureEnabled(catalog.id, FeatureKey.Metadata),
    getCatalogSchema(catalog.id),
  ]);
  // Seed the metadata schema into the page so every consumer (search panel,
  // smart-album builder, lightbox Info tab, upload editor) reads it instantly —
  // no per-component /metadata/schema fetch.
  const metaSchema = metaOn ? rawSchema : [];
  return (
    <CatalogProvider catalog={{ id: catalog.id, slug: catalog.slug, name: catalog.name }}>
      <RememberCatalog slug={catalog.slug} />
      <LibraryTreeProvider>
        <FeaturesProvider value={features}>
          <MetadataSchemaProvider slug={catalog.slug} schema={metaSchema}>
            <SoundSettingsProvider enabled={settings.soundEffectsEnabled} />
            {/* Sidebar is fixed (not in flow); offset content by its 76px width. */}
            <AppSidebar />
            <div className="min-h-dvh pl-[76px]">{children}</div>
          </MetadataSchemaProvider>
        </FeaturesProvider>
      </LibraryTreeProvider>
    </CatalogProvider>
  );
}
