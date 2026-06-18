import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sanitizeMetadata, extractMetadata } from "./metadata.js";

describe("sanitizeMetadata", () => {
  it("converts Dates to ISO strings", () => {
    const d = new Date("2024-03-14T09:26:53.000Z");
    expect(sanitizeMetadata(d)).toBe("2024-03-14T09:26:53.000Z");
  });

  it("drops Buffers, typed arrays and functions", () => {
    const out = sanitizeMetadata({
      keep: "yes",
      buf: Buffer.from([1, 2, 3]),
      arr: new Uint8Array([4, 5]),
      fn: () => 1,
    }) as Record<string, unknown>;
    expect(out).toEqual({ keep: "yes" });
  });

  it("recurses nested objects and arrays and preserves primitives", () => {
    const out = sanitizeMetadata({
      n: 2.8,
      b: true,
      nested: { d: new Date("2020-01-01T00:00:00.000Z"), list: [1, "x", Buffer.from([0])] },
    });
    expect(out).toEqual({
      n: 2.8,
      b: true,
      nested: { d: "2020-01-01T00:00:00.000Z", list: [1, "x"] },
    });
  });

  it("produces JSON-serialisable output", () => {
    const out = sanitizeMetadata({ d: new Date(), buf: Buffer.from([1]), bad: NaN });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("passes null through unchanged", () => {
    expect(sanitizeMetadata(null)).toBeNull();
    expect(sanitizeMetadata({ gps: null })).toEqual({ gps: null });
  });

  it("drops invalid Dates", () => {
    expect(sanitizeMetadata(new Date("not a date"))).toBeUndefined();
    expect(sanitizeMetadata({ ts: new Date("not a date") })).toEqual({});
  });

  it("strips NUL bytes from strings and keys (PostgreSQL jsonb cannot store \u0000)", () => {
    // Real-world trigger: the IPTC ApplicationRecordVersion tag parses to "\u0000".
    expect(sanitizeMetadata("\u0000")).toBe("");
    expect(sanitizeMetadata({ ApplicationRecordVersion: "\u0000" })).toEqual({
      ApplicationRecordVersion: "",
    });
    const out = sanitizeMetadata({ note: "a\u0000b", list: ["x\u0000y"], "k\u0000ey": "v" });
    expect(out).toEqual({ note: "ab", list: ["xy"], key: "v" });
    // The serialized form must not contain a NUL escape (Postgres would reject it).
    expect(JSON.stringify(out)).not.toContain("\u0000");
  });
});

/** Splice an XMP APP1 segment (the way embedded XMP lives in a JPEG) right after SOI. */
function embedXmp(jpeg: Buffer, xmpPacket: string): Buffer {
  const sig = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
  const payload = Buffer.concat([sig, Buffer.from(xmpPacket, "utf8")]);
  const len = payload.length + 2; // length field includes its own 2 bytes
  const header = Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]);
  const segment = Buffer.concat([header, payload]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

describe("extractMetadata", () => {
  it("surfaces standard photographic fields and curated keys", async () => {
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#345" } })
      .withExif({
        IFD0: { Make: "Lumio", Model: "FixtureCam" },
        IFD2: {
          DateTimeOriginal: "2024:03:14 09:26:53",
          FNumber: "28/10",
          ISOSpeedRatings: "400",
          FocalLength: "50/1",
          LensModel: "Nifty Fifty",
        },
      })
      .jpeg()
      .toBuffer();

    const { exif, takenAt } = await extractMetadata(jpeg);

    expect(exif.FNumber).toBe(2.8);
    expect(exif.ISO).toBe(400);
    expect(exif.FocalLength).toBe(50);
    expect(exif.LensModel).toBe("Nifty Fifty");
    expect(exif.cameraMake).toBe("Lumio");
    expect(exif.cameraModel).toBe("FixtureCam");
    expect(exif.takenAt).toBe("2024-03-14T09:26:53.000Z");
    expect(takenAt?.toISOString()).toBe("2024-03-14T09:26:53.000Z");
    expect(exif.DateTimeOriginal).toBe("2024-03-14T09:26:53.000Z");
  });

  it("reads custom-namespace tags from embedded XMP (e.g. filmexif)", async () => {
    const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer();
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:filmexif="http://filmexif.app/ns/1.0/"
    filmexif:FilmStock="Kodak Portra 400"
    filmexif:FilmISO="400"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const { exif } = await extractMetadata(embedXmp(base, xmp));
    expect(exif.FilmStock).toBe("Kodak Portra 400");
    expect(exif.FilmISO).toBe(400);
  });

  it("returns no takenAt for an image with no date metadata", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    const { exif, takenAt } = await extractMetadata(png);
    expect(takenAt).toBeNull();
    expect(exif.takenAt).toBeUndefined();
  });

  it("falls back to CreateDate when DateTimeOriginal is absent", async () => {
    // sharp/libexif's input tag is DateTimeDigitized; exifr surfaces it as CreateDate.
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
      .withExif({ IFD2: { DateTimeDigitized: "2022:01:02 03:04:05" } })
      .jpeg()
      .toBuffer();
    const { exif, takenAt } = await extractMetadata(jpeg);
    expect(takenAt?.toISOString()).toBe("2022-01-02T03:04:05.000Z");
    expect(exif.takenAt).toBe("2022-01-02T03:04:05.000Z");
  });
});
