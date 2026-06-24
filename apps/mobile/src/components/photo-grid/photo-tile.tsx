import { memo, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { PhotoDTO } from "@lumio/shared";
import { thumbnailUrl } from "@/lib/photos-api";
import type { Rect } from "@/lib/rect";

/**
 * One grid tile. The base64 ThumbHash is shown as a blur placeholder while the
 * authenticated WebP thumbnail loads (expo-image decodes ThumbHash natively).
 * The session cookie is sent as a request header because the thumbnail endpoint
 * is auth-gated. `fit` toggles cover (square crop) vs contain (whole photo,
 * letterboxed) — the iOS aspect toggle. `onPress` reports the tile's window rect
 * so the viewer can animate open from it.
 */
export const PhotoTile = memo(function PhotoTile({
  photo,
  baseURL,
  slug,
  cookie,
  fit = "cover",
  onPress,
}: {
  photo: PhotoDTO;
  baseURL: string;
  slug: string;
  cookie: string;
  fit?: "cover" | "contain";
  onPress?: (rect: Rect) => void;
}) {
  const ref = useRef<View>(null);

  const handlePress = () => {
    if (!onPress) return;
    ref.current?.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
  };

  return (
    <Pressable ref={ref} style={styles.cell} onPress={handlePress} disabled={!onPress}>
      <Image
        style={styles.image}
        source={{ uri: thumbnailUrl(baseURL, slug, photo), headers: { Cookie: cookie } }}
        placeholder={photo.thumbhash ? { thumbhash: photo.thumbhash } : undefined}
        contentFit={fit}
        transition={150}
        recyclingKey={photo.id}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // flex:1 fills the FlashList column slot; aspectRatio keeps tiles square; the
  // 1px padding makes the ~2px inter-tile gap of the iOS Photos grid.
  cell: { flex: 1, aspectRatio: 1, padding: 1 },
  image: { flex: 1, backgroundColor: "rgba(127,127,127,0.12)" },
});
