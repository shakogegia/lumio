import { countLabel } from "@/lib/count-label";

/** "{n} folders · {m} photos" — the subfolder count always shows, the photo count
 *  only when > 0 (mirrors the /albums folder card subtitle). */
export function folderSubtitle(subfolderCount: number, photoCount: number): string {
  const parts = [countLabel(subfolderCount, "folder", "folders")];
  if (photoCount > 0) parts.push(countLabel(photoCount, "photo", "photos"));
  return parts.join(" · ");
}
