import type { Metadata } from "next";
import { Suspense } from "react";
import { getSettings } from "@lumio/db";
import {
  getCatalogStats,
  getPhotoFileCount,
  getStorageSizes,
} from "@/lib/status-service";
import { formatBytes } from "@/lib/format";
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

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

/** Count of image files actually on disk; streamed so it never blocks the page. */
async function FilesOnDisk() {
  const count = await getPhotoFileCount();
  return <InfoRow label="Files on disk" value={count.toLocaleString()} />;
}

/** On-disk byte sizes (filesystem walk); streamed so they never block the page. */
async function StorageSizes() {
  const { photosSize, thumbnailsSize, displaysSize, trashSize } = await getStorageSizes();
  return (
    <>
      <InfoRow label="Photo storage" value={formatBytes(photosSize)} />
      <InfoRow label="Thumbnail cache" value={formatBytes(thumbnailsSize)} />
      <InfoRow label="Preview cache" value={formatBytes(displaysSize)} />
      <InfoRow label="Trash" value={formatBytes(trashSize)} />
    </>
  );
}

export default async function SettingsPage() {
  const stats = await getCatalogStats();
  const settings = await getSettings();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Tabs defaultValue="catalog" className="gap-6">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-8">
          <InfoList>
            <InfoRow label="Library folder" value={stats.photosDir} mono />
            <InfoRow label="Photos" value={stats.photoCount.toLocaleString()} />
            <Suspense
              fallback={
                <InfoRow
                  label="Files on disk"
                  value={<span className="text-muted-foreground">counting…</span>}
                />
              }
            >
              <FilesOnDisk />
            </Suspense>
            <Suspense
              fallback={
                <>
                  {["Photo storage", "Thumbnail cache", "Preview cache", "Trash"].map((label) => (
                    <InfoRow
                      key={label}
                      label={label}
                      value={
                        <span className="text-muted-foreground">calculating…</span>
                      }
                    />
                  ))}
                </>
              }
            >
              <StorageSizes />
            </Suspense>
            <InfoRow
              label="Last updated"
              value={
                stats.lastIndexedAt ? (
                  <RelativeTime iso={stats.lastIndexedAt} />
                ) : (
                  "never"
                )
              }
            />
          </InfoList>

          <div className="-mt-6 flex justify-end">
            <RefreshStatsButton />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Indexing</CardTitle>
              <CardDescription>
                Scan the library for new and deleted files. Existing photos and
                their edits are left untouched.
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
              <UploadTemplateForm initial={settings.uploadTemplate} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger">
          <Card>
            <CardHeader>
              <CardTitle>Delete all photos</CardTitle>
              <CardDescription>
                Remove every photo from the database and filesystem, including
                cached thumbnails.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeleteAllPhotos photoCount={stats.photoCount} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
