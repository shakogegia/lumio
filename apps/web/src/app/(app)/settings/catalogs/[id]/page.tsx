import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronRight } from "lucide-react";
import { getCatalogById, getCatalogFeatureStates } from "@lumio/db";
import {
  getCatalogStats,
  getPhotoFileCount,
  getStorageSizes,
} from "@/lib/server/status-service";
import { formatBytes } from "@/lib/format";
import { CatalogProvider } from "@/components/providers/catalog-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoList, InfoRow } from "@/components/ui/info-list";
import { DeleteAllPhotos } from "./danger-zone";
import { RefreshStatsButton } from "./refresh-stats-button";
import { RelativeTime } from "./relative-time";
import { RescanButton } from "./rescan-button";
import { UploadTemplateForm } from "./upload-template-form";
import { CatalogFeaturesForm } from "./catalog-features-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Catalog settings" };

/** Count of image files actually on disk; streamed so it never blocks the page. */
async function FilesOnDisk({ catalog }: { catalog: { id: string; path: string } }) {
  const count = await getPhotoFileCount(catalog);
  return <InfoRow label="Files on disk" value={count.toLocaleString()} />;
}

/** On-disk byte sizes (filesystem walk); streamed so they never block the page. */
async function StorageSizes({ catalog }: { catalog: { id: string; path: string } }) {
  const { photosSize, thumbnailsSize, displaysSize, trashSize } = await getStorageSizes(catalog);
  return (
    <>
      <InfoRow label="Photo storage" value={formatBytes(photosSize)} />
      <InfoRow label="Thumbnail cache" value={formatBytes(thumbnailsSize)} />
      <InfoRow label="Preview cache" value={formatBytes(displaysSize)} />
      <InfoRow label="Trash" value={formatBytes(trashSize)} />
    </>
  );
}

export default async function CatalogSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalogById(id);
  if (!catalog) notFound();
  const stats = await getCatalogStats(catalog.id);
  const featureStates = await getCatalogFeatureStates(catalog.id);

  return (
    <CatalogProvider catalog={{ id: catalog.id, slug: catalog.slug, name: catalog.name }}>
      <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
        <div className="space-y-2">
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/settings/catalogs" className="transition-colors hover:text-foreground">
              Catalogs
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span className="text-foreground">{catalog.name}</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight">{catalog.name}</h1>
        </div>

        <Tabs defaultValue="catalog" className="gap-6">
          <TabsList>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            <TabsTrigger value="uploads">Uploads</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="space-y-8">
            <InfoList>
              <InfoRow label="Library folder" value={catalog.path} mono />
              <InfoRow label="Photos" value={stats.photoCount.toLocaleString()} />
              <Suspense
                fallback={
                  <InfoRow
                    label="Files on disk"
                    value={<span className="text-muted-foreground">counting…</span>}
                  />
                }
              >
                <FilesOnDisk catalog={catalog} />
              </Suspense>
              <Suspense
                fallback={
                  <>
                    {["Photo storage", "Thumbnail cache", "Preview cache", "Trash"].map((label) => (
                      <InfoRow
                        key={label}
                        label={label}
                        value={<span className="text-muted-foreground">calculating…</span>}
                      />
                    ))}
                  </>
                }
              >
                <StorageSizes catalog={catalog} />
              </Suspense>
              <InfoRow
                label="Last updated"
                value={stats.lastIndexedAt ? <RelativeTime iso={stats.lastIndexedAt} /> : "never"}
              />
            </InfoList>

            <div className="-mt-6 flex justify-end">
              <RefreshStatsButton />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Indexing</CardTitle>
                <CardDescription>
                  Scan the library for new and deleted files. Existing photos and their edits are
                  left untouched.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RescanButton />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="uploads">
            <Card>
              <CardHeader>
                <CardTitle>Uploads</CardTitle>
                <CardDescription>
                  Choose the folder structure for newly uploaded photos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UploadTemplateForm initial={catalog.uploadTemplate} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features">
            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
                <CardDescription>
                  Enable or disable optional features for this catalog. The global
                  switch in Settings → Features is the master.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CatalogFeaturesForm catalogId={catalog.id} initial={featureStates} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger">
            <Card>
              <CardHeader>
                <CardTitle>Delete all photos</CardTitle>
                <CardDescription>
                  Remove every photo from the database and filesystem, including cached thumbnails.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DeleteAllPhotos photoCount={stats.photoCount} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </CatalogProvider>
  );
}
