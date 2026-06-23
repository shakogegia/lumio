import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { PhotoDTO } from "@lumio/shared";
import { thumbnailUrl } from "@/lib/photos-api";

/**
 * One square, cover-cropped grid tile (iOS Photos look). The base64 ThumbHash is
 * shown as a blur placeholder while the authenticated WebP thumbnail loads
 * (expo-image decodes ThumbHash natively). The session cookie is sent as a
 * request header because the thumbnail endpoint is auth-gated. `recyclingKey`
 * tells expo-image to drop the previous image when a cell is recycled by
 * FlashList, preventing a flash of the wrong photo.
 */
export const PhotoTile = memo(function PhotoTile({
  photo,
  baseURL,
  slug,
  cookie,
}: {
  photo: PhotoDTO;
  baseURL: string;
  slug: string;
  cookie: string;
}) {
  return (
    <View style={styles.cell}>
      <Image
        style={styles.image}
        source={{ uri: thumbnailUrl(baseURL, slug, photo), headers: { Cookie: cookie } }}
        placeholder={photo.thumbhash ? { thumbhash: photo.thumbhash } : undefined}
        contentFit="cover"
        transition={150}
        recyclingKey={photo.id}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  // flex:1 fills the FlashList column slot; aspectRatio keeps tiles square; the
  // 1px padding makes the ~2px inter-tile gap of the iOS Photos grid.
  cell: { flex: 1, aspectRatio: 1, padding: 1 },
  image: { flex: 1, backgroundColor: "rgba(127,127,127,0.12)" },
});
