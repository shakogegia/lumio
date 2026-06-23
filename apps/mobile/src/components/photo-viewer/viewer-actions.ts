import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { PhotoDTO } from "@lumio/shared";
import { originalUrl } from "@/lib/photos-api";

/** Download the original (auth-gated) to the cache, then open the OS share sheet.
 *  No-ops if sharing isn't available; errors are surfaced to the caller. */
export async function shareOriginal(
  baseURL: string,
  slug: string,
  cookie: string,
  photo: Pick<PhotoDTO, "id" | "path">,
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;
  const ext = (photo.path.split(".").pop() || "jpg").toLowerCase();
  const dest = `${FileSystem.cacheDirectory}lumio-share-${photo.id}.${ext}`;
  const { uri } = await FileSystem.downloadAsync(originalUrl(baseURL, slug, photo), dest, {
    headers: { Cookie: cookie },
  });
  await Sharing.shareAsync(uri);
}
