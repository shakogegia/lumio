import { getSettings } from "@lumio/db";
import { getStatus } from "@/lib/status-service";
import { Card } from "@/components/ui/card";
import { DeleteAllPhotos } from "./danger-zone";
import { RescanButton } from "./rescan-button";
import { UploadTemplateForm } from "./upload-template-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getStatus();
  const settings = await getSettings();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="space-y-3 p-4">
        <Row label="Photos directory" value={status.photosDir} />
        <Row label="Indexed photos" value={String(status.photoCount)} />
        <Row label="Last indexed" value={status.lastIndexedAt ?? "never"} />
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Uploads</h2>
        <p className="text-sm text-muted-foreground">
          How uploaded photos are organized into folders under your library.
        </p>
        <UploadTemplateForm initial={settings.uploadTemplate} />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Indexing</h2>
        <p className="text-sm text-muted-foreground">
          Trigger a full rescan of the photos directory.
        </p>
        <RescanButton />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium text-destructive">Danger zone</h2>
        <p className="text-sm text-muted-foreground">
          Irreversible actions. Proceed with caution.
        </p>
        <Card className="space-y-4 border-destructive/30 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Delete all photos</p>
              <p className="text-sm text-muted-foreground">
                Remove every photo from the database and filesystem, including cached thumbnails.
              </p>
            </div>
            <DeleteAllPhotos photoCount={status.photoCount} />
          </div>
        </Card>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono">{value}</span>
    </div>
  );
}
