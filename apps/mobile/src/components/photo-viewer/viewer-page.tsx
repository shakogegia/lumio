import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { PhotoDTO } from "@lumio/shared";
import { displayUrl } from "@/lib/photos-api";

/** One full-screen page in the viewer: the display rendition (edited-or-base
 *  WebP), contained, with the ThumbHash blur as placeholder and the auth Cookie
 *  header. Per-photo zoom is layered on in a later phase. */
export const ViewerPage = memo(function ViewerPage({
  photo,
  baseURL,
  slug,
  cookie,
  width,
  height,
}: {
  photo: PhotoDTO;
  baseURL: string;
  slug: string;
  cookie: string;
  width: number;
  height: number;
}) {
  return (
    <View style={{ width, height }}>
      <Image
        style={StyleSheet.absoluteFill}
        source={{ uri: displayUrl(baseURL, slug, photo), headers: { Cookie: cookie } }}
        placeholder={photo.thumbhash ? { thumbhash: photo.thumbhash } : undefined}
        contentFit="contain"
        transition={150}
        recyclingKey={photo.id}
      />
    </View>
  );
});
