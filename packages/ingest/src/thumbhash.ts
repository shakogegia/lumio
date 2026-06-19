import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";

/**
 * Compute a base64 ThumbHash from an image (a Buffer or a file path). ThumbHash
 * needs raw RGBA at <=100px per side. We feed it the already-generated thumbnail
 * so the ingest pipeline and the backfill produce identical hashes.
 */
export async function computeThumbhash(image: string | Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .resize(100, 100, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = rgbaToThumbHash(info.width, info.height, new Uint8Array(data));
  return Buffer.from(hash).toString("base64");
}
