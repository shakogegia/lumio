"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { exifEntries, filterExifEntries } from "@/lib/exif-entries";
import { usePhotoCollection } from "@/features/photo-grid";
import { LightboxEditPanel } from "@/features/photo-editor";
import { LightboxTab } from "@/lib/lightbox-tab";
import { PhotoInfoPanel } from "@/features/photo-info";

export function LightboxSidebar({ photo }: { photo: PhotoDTO }) {
  // Controlled by the shared collection state so the i/e keyboard shortcuts can
  // drive the tab from the lightbox-level keyboard handler.
  const { openTab, setOpenTab } = usePhotoCollection();
  const metadata = exifEntries(photo.exif);

  return (
    <aside className="w-full shrink-0 border-t bg-background text-sm lg:flex lg:h-dvh lg:w-80 lg:flex-col lg:overflow-hidden lg:border-t-0 lg:border-l">
      <Tabs
        value={openTab}
        onValueChange={(v) => setOpenTab(v as LightboxTab)}
        className="gap-0 lg:min-h-0 lg:flex-1"
      >
        <div className="flex shrink-0 items-center border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value={LightboxTab.Info}>
              Info
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">i</Kbd>
            </TabsTrigger>
            <TabsTrigger value={LightboxTab.Edit}>
              Edit
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">e</Kbd>
            </TabsTrigger>
            <TabsTrigger value={LightboxTab.Exif}>EXIF</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
          <TabsContent value={LightboxTab.Info}>
            <PhotoInfoPanel photo={photo} />
          </TabsContent>

          <TabsContent value={LightboxTab.Edit} className="lg:flex lg:flex-col">
            <LightboxEditPanel />
          </TabsContent>

          <TabsContent value={LightboxTab.Exif}>
            <ExifPanel entries={metadata} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function ExifPanel({ entries }: { entries: Array<[string, string]> }) {
  const [query, setQuery] = useState("");
  const filtered = filterExifEntries(entries, query);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search metadata"
          aria-label="Search metadata"
          className="pl-9"
        />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metadata</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No metadata matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <dl className="space-y-1 text-xs">
          {filtered.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-all text-right font-mono">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
