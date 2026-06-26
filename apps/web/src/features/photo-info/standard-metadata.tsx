import { Camera, Aperture, Calendar } from "lucide-react";
import type { ReactNode } from "react";
import { standardMetadataLines, type ExifData } from "@lumio/shared";

/** Icon-led summary of standardized EXIF, à la Apple Photos. Renders nothing
 *  when the photo carries none of the standard fields. */
export function StandardMetadata({ exif }: { exif: ExifData }) {
  const lines = standardMetadataLines(exif);
  if (!lines) return null;

  return (
    <div className="space-y-3">
      {(lines.camera || lines.exposure) && (
        <Line icon={<Camera className="size-5" aria-hidden />}>
          {lines.camera && <div className="font-medium">{lines.camera}</div>}
          {lines.exposure && <div className="text-muted-foreground">{lines.exposure}</div>}
        </Line>
      )}
      {lines.optics && (
        <Line icon={<Aperture className="size-5" aria-hidden />}>
          <div className="font-medium">{lines.optics}</div>
        </Line>
      )}
      {lines.date && (
        <Line icon={<Calendar className="size-5" aria-hidden />}>
          <div>{lines.date}</div>
        </Line>
      )}
    </div>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-5 shrink-0 justify-center text-muted-foreground">{icon}</span>
      <div className="min-w-0 leading-tight">{children}</div>
    </div>
  );
}
