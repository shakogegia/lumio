import { getSettings } from "@lumio/db";
import { getStatus } from "@/lib/status-service";
import { formatBytes } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoList, InfoRow } from "@/components/ui/info-list";
import { DeleteAllPhotos } from "./danger-zone";
import { RelativeTime } from "./relative-time";
import { RescanButton } from "./rescan-button";
import { UploadTemplateForm } from "./upload-template-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getStatus();
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
            <InfoRow label="Library folder" value={status.photosDir} mono />
            <InfoRow label="Photos" value={status.photoCount.toLocaleString()} />
            <InfoRow label="Albums" value={status.albumCount.toLocaleString()} />
            <InfoRow label="Photo storage" value={formatBytes(status.photosSize)} />
            <InfoRow label="Thumbnail cache" value={formatBytes(status.thumbnailsSize)} />
            <InfoRow label="Preview cache" value={formatBytes(status.displaysSize)} />
            <InfoRow
              label="Last updated"
              value={
                status.lastIndexedAt ? <RelativeTime iso={status.lastIndexedAt} /> : "never"
              }
            />
          </InfoList>

          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-base font-medium">Indexing</h2>
              <p className="text-sm text-muted-foreground">
                Trigger a full rescan of the photos directory.
              </p>
            </div>
            <RescanButton />
          </section>
        </TabsContent>

        <TabsContent value="uploads">
          <UploadTemplateForm initial={settings.uploadTemplate} />
        </TabsContent>

        <TabsContent value="danger">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Delete all photos</p>
              <p className="text-sm text-muted-foreground">
                Remove every photo from the database and filesystem, including cached thumbnails.
              </p>
            </div>
            <DeleteAllPhotos photoCount={status.photoCount} />
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
