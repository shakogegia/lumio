import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractUploadDate } from "./upload-date.js";

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
    .withExif({ IFD2: { DateTimeOriginal: "2024:03:14 09:26:53" } })
    .jpeg()
    .toBuffer();
}

async function jpegNoExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
    .jpeg()
    .toBuffer();
}

/** Splice an XMP APP1 segment (the way embedded XMP lives in a JPEG) right after SOI. */
function embedXmp(jpeg: Buffer, xmpPacket: string): Buffer {
  const sig = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
  const payload = Buffer.concat([sig, Buffer.from(xmpPacket, "utf8")]);
  const len = payload.length + 2; // length field includes its own 2 bytes
  const header = Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]);
  const segment = Buffer.concat([header, payload]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** A film-scan-style JPEG carrying only xmp:CreateDate — no EXIF capture tags. */
async function jpegWithXmpCreateDateOnly(): Promise<Buffer> {
  const base = await jpegNoExif();
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:CreateDate="2023-11-12T21:36:53"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  return embedXmp(base, xmp);
}

describe("extractUploadDate", () => {
  it("uses EXIF DateTimeOriginal when present", async () => {
    const date = await extractUploadDate(await jpegWithExif(), undefined, new Date("2030-01-01T00:00:00Z"));
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth() + 1).toBe(3);
    expect(date.getUTCDate()).toBe(14);
  });

  it("recovers the capture date from xmp:CreateDate (film scans), not lastModified", async () => {
    const lastModified = Date.UTC(2030, 0, 1); // would win if XMP were ignored
    const date = await extractUploadDate(
      await jpegWithXmpCreateDateOnly(),
      lastModified,
      new Date("2031-01-01T00:00:00Z"),
    );
    expect(date.toISOString()).toBe("2023-11-12T21:36:53.000Z");
  });

  it("falls back to lastModified when EXIF has no date", async () => {
    const lastModified = Date.UTC(2023, 4, 20); // 2023-05-20
    const date = await extractUploadDate(await jpegNoExif(), lastModified, new Date("2030-01-01T00:00:00Z"));
    expect(date.getTime()).toBe(lastModified);
  });

  it("falls back to now when neither EXIF nor lastModified is available", async () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const date = await extractUploadDate(await jpegNoExif(), undefined, now);
    expect(date.getTime()).toBe(now.getTime());
  });
});
