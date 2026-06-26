"use client";

import { FeatureKey, type PhotoDTO } from "@lumio/shared";
import { Separator } from "@/components/ui/separator";
import { FeatureGate } from "@/components/features/features-provider";
import { StandardMetadata } from "./standard-metadata";
import { InfoRows } from "./info-rows";
import { MetadataPanel } from "./metadata-panel";
import { AlbumMembership } from "./album-membership";

/**
 * The single-photo "Info" view — the shared body of the lightbox Info tab and
 * the selection inspector (when exactly one photo is selected). Owns its own
 * vertical rhythm so any host can drop it in unwrapped. Redesign it here and it
 * changes everywhere it's shown.
 */
export function PhotoInfoPanel({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-3">
      <FeatureGate feature={FeatureKey.StandardMetadata}>
        <StandardMetadata exif={photo.exif} />
        <Separator />
      </FeatureGate>
      <InfoRows photo={photo} />
      <FeatureGate feature={FeatureKey.Metadata}>
        <Separator />
        {/* Keyed on photo.id so values re-init per photo during arrow-key nav. */}
        <MetadataPanel key={photo.id} photo={photo} />
      </FeatureGate>
      <Separator />
      <AlbumMembership key={photo.id} photo={photo} />
    </div>
  );
}
